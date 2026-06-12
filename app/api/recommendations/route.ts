import {
  hasClosingSoonLabel,
  hasJustOpenedLabel,
  isRecommended,
} from '@/lib/planner/badges'
import { isEvent } from '@/lib/planner/category'
import { freshness, scoreWithoutEtas } from '@/lib/planner/score'
import type { PlanCard, Profile, Venue } from '@/lib/planner/types'
import { createClient } from '@/lib/supabase/server'

// Lightweight recommendations endpoint for the search-form home view.
// No routing, no profile required — surfaces this week's most relevant picks
// across dining and events. Three collections so the UI can render three
// horizontal scroll rails: trending, new, limited-run.

const PER_LIST_LIMIT = 6

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
  const trending = pickTrending(venues, now)
  const newOpenings = pickNew(venues)
  const limited = pickLimited(venues)

  return Response.json({
    trending: toPlanCards(trending),
    new: toPlanCards(newOpenings),
    limited: toPlanCards(limited),
  } satisfies Record<Collection['key'], PlanCard[]>)
}

async function loadVenues(): Promise<Venue[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('venues').select('*').eq('active', true)
  if (error) throw new Error(error.message)
  return (data ?? []) as Venue[]
}

function pickTrending(venues: Venue[], now: Date): Venue[] {
  return [...venues]
    .filter((v) => {
      if (isRecommended(v)) return true
      // Surface all upcoming events even if trending_score is 0 — they're
      // time-bounded so any future exhibition is relevant.
      if (isEvent(v)) {
        const ends = v.badge_meta?.ends_at
        if (typeof ends !== 'string' && typeof ends !== 'number') return true
        return new Date(ends as string | number) > now
      }
      return false
    })
    .sort((a, b) => freshness(b) - freshness(a))
    .slice(0, PER_LIST_LIMIT)
}

function pickNew(venues: Venue[]): Venue[] {
  return [...venues]
    .filter(hasJustOpenedLabel)
    .sort((a, b) => b.trending_score - a.trending_score)
    .slice(0, PER_LIST_LIMIT)
}

function pickLimited(venues: Venue[]): Venue[] {
  return [...venues]
    .filter(hasClosingSoonLabel)
    .sort((a, b) => endsAtTime(a) - endsAtTime(b))
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
