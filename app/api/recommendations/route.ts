import { isEvent } from '@/lib/planner/category'
import { scoreWithoutEtas } from '@/lib/planner/score'
import type { PlanCard, Profile, Venue } from '@/lib/planner/types'
import { createClient } from '@/lib/supabase/server'
import { catalog } from '@/lib/venues/catalog'

// Lightweight recommendations endpoint for the search-form home view.
// No routing, no profile required — surfaces this week's most relevant picks
// across dining and events. Three collections so the UI can render three
// horizontal scroll rails: trending, new, limited-run.

const PER_LIST_LIMIT = 6
const NEW_OPENING_DAYS = 90
const LIMITED_RUN_DAYS = 14

type Collection = {
  key: 'trending' | 'new' | 'limited'
  cards: PlanCard[]
}

const NEUTRAL_PROFILE: Profile = {
  planner_name: '',
  partner_name: '',
  cuisines_loved: [],
  cuisines_avoided: [],
  dietary_hardstops: [],
  vibe_defaults: [],
  budget_bands: [],
  transit_pref: 'either',
}

export async function GET() {
  const venues = await loadVenues()
  const now = new Date()
  const trending = pickTrending(venues)
  const newOpenings = pickNew(venues, now)
  const limited = pickLimited(venues, now)

  return Response.json({
    trending: toPlanCards(trending),
    new: toPlanCards(newOpenings),
    limited: toPlanCards(limited),
  } satisfies Record<Collection['key'], PlanCard[]>)
}

async function loadVenues(): Promise<Venue[]> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return catalog.filter((v) => v.active)
  }
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.from('venues').select('*').eq('active', true)
    if (error) throw new Error(error.message)
    return (data ?? []) as Venue[]
  } catch {
    return catalog.filter((v) => v.active)
  }
}

function pickTrending(venues: Venue[]): Venue[] {
  return [...venues]
    .filter((v) => v.trending_score >= 0.55 || v.badge === 'critic_pick' || v.badge === 'award_fresh')
    .sort((a, b) => b.trending_score - a.trending_score)
    .slice(0, PER_LIST_LIMIT)
}

function pickNew(venues: Venue[], now: Date): Venue[] {
  const cutoff = now.getTime() - NEW_OPENING_DAYS * 24 * 60 * 60 * 1000
  return [...venues]
    .filter((v) => {
      if (v.badge !== 'soft_launch') return false
      const opened = v.badge_meta?.opened
      if (typeof opened !== 'string') return true
      const t = new Date(opened).getTime()
      return Number.isFinite(t) && t >= cutoff
    })
    .sort((a, b) => b.trending_score - a.trending_score)
    .slice(0, PER_LIST_LIMIT)
}

function pickLimited(venues: Venue[], now: Date): Venue[] {
  const horizon = now.getTime() + LIMITED_RUN_DAYS * 24 * 60 * 60 * 1000
  return [...venues]
    .filter((v) => {
      if (v.badge !== 'closing_soon') return false
      const ends = v.badge_meta?.ends_at
      if (typeof ends !== 'string') return true
      const t = new Date(ends).getTime()
      // Surface anything ending within the next two weeks. Past dates are
      // still listed so the demo doesn't go empty if the catalog is stale.
      return !Number.isFinite(t) || t <= horizon || t >= now.getTime()
    })
    .sort((a, b) => {
      const aEnd = endsAtTime(a)
      const bEnd = endsAtTime(b)
      return aEnd - bEnd
    })
    .slice(0, PER_LIST_LIMIT)
}

function endsAtTime(v: Venue): number {
  const ends = v.badge_meta?.ends_at
  if (typeof ends !== 'string') return Number.POSITIVE_INFINITY
  const t = new Date(ends).getTime()
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY
}

function toPlanCards(venues: Venue[]): PlanCard[] {
  return venues.map((v) => ({
    ...scoreWithoutEtas(v, NEUTRAL_PROFILE, []),
    bucket: isEvent(v) ? ('event' as const) : ('dining' as const),
  }))
}
