import { mapWithConcurrency } from '@/lib/async/pool'
import { fetchDriveRoute, type DriveRouteResult } from '@/lib/onemap/client'
import { isOpenAt } from '@/lib/planner/hours'
import type { PlanRequest } from '@/lib/planner/request-validation'
import {
  bucketByCategory,
  prescore,
  scoreWithETAs,
  scoreWithSingleEta,
  scoreWithoutEtas,
} from '@/lib/planner/score'
import type { LatLng, Profile, Venue } from '@/lib/planner/types'
import { createClient } from '@/lib/supabase/server'
import { fetchWeatherCondition, type WeatherResult } from '@/lib/weather'

// Cap on how many candidates we route after hard-filtering. Each survivor
// costs up to 2 OneMap drive-route calls. Sized generously since with two
// categories (dining + events) we want depth in both.
const ROUTING_CANDIDATE_CAP = 24
const ROUTING_CONCURRENCY = 5

type VenueLoadResult = {
  venues: Venue[]
  source: 'supabase'
  fallback_reason?: string
}

export type PlanDateDeps = {
  loadVenues?: (profile: Profile, overrides: string[]) => Promise<VenueLoadResult>
  getWeather?: (at: Date) => Promise<WeatherResult>
  getDirection?: (origin: LatLng, destination: LatLng) => Promise<DriveRouteResult>
  hasRoutingApiKey?: () => boolean
}

export class PlanDateError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message)
  }
}

export async function planDate(request: PlanRequest, deps: PlanDateDeps = {}) {
  const scheduledDate = new Date(request.scheduled_for)
  if (Number.isNaN(scheduledDate.getTime())) {
    throw new PlanDateError('scheduled_for must be a valid ISO date', 400)
  }

  const getWeather = deps.getWeather ?? fetchWeatherCondition
  const loadVenues = deps.loadVenues ?? loadVenuesWithFallback
  const getDirection = deps.getDirection ?? fetchDriveRoute
  const hasRoutingApiKey =
    deps.hasRoutingApiKey ??
    (() => Boolean(process.env.ONEMAP_EMAIL && process.env.ONEMAP_PASSWORD))

  const weather = await getWeather(scheduledDate)
  const { venues, source, fallback_reason } = await loadVenues(request.profile, request.override_tags)

  // Augment the user's stated preferences with derived affinity from venues
  // they've shortlisted. matchScore boosts venues that share cuisine_tags or
  // vibe_tags with the user's loved set; merging shortlist tags into that set
  // makes "more like the ones I saved" a free side-effect of the existing
  // scoring path. No schema change, no new component.
  const profile = applyShortlistAffinity(request.profile, request.shortlist_ids, venues)

  const candidates = filterCandidates(venues, profile, request.override_tags, weather, scheduledDate)

  // Counterfactual: how many candidates would have surfaced if it weren't
  // raining? We use this to drive a "X outdoor spots hidden — rain expected"
  // pill in the UI, so users understand why outdoor venues are absent.
  const outdoorExcluded =
    weather.condition === 'rain'
      ? filterCandidates(
          venues,
          profile,
          request.override_tags,
          { ...weather, condition: 'clear' },
          scheduledDate
        ).length - candidates.length
      : 0

  const topByPrescore = [...candidates]
    .sort((a, b) => prescore(b, profile) - prescore(a, profile))
    .slice(0, ROUTING_CANDIDATE_CAP)

  if (topByPrescore.length === 0) {
    return {
      buckets: emptyBuckets(),
      meta: { ...emptyMeta(source, venues.length), fallback_reason },
    }
  }

  const startA = request.start_a
  const startB = request.start_b
  const needsRouting = Boolean(startA || startB)

  if (needsRouting && !hasRoutingApiKey()) {
    throw new PlanDateError(
      'OneMap credentials missing — set ONEMAP_EMAIL and ONEMAP_PASSWORD',
      500
    )
  }

  let cachedLegs = 0

  const routed = await mapWithConcurrency(topByPrescore, ROUTING_CONCURRENCY, async (venue) => {
    try {
      if (startA && startB) {
        const [a, b] = await Promise.all([
          getDirection(startA, { lat: venue.lat, lng: venue.lng }),
          getDirection(startB, { lat: venue.lat, lng: venue.lng }),
        ])
        if (a.cached) cachedLegs++
        if (b.cached) cachedLegs++
        return scoreWithETAs(
          venue,
          profile,
          Math.round(a.duration_sec / 60),
          Math.round(b.duration_sec / 60),
          request.override_tags
        )
      }
      if (startA || startB) {
        const start = (startA ?? startB) as LatLng
        const a = await getDirection(start, { lat: venue.lat, lng: venue.lng })
        if (a.cached) cachedLegs++
        return scoreWithSingleEta(
          venue,
          profile,
          Math.round(a.duration_sec / 60),
          request.override_tags
        )
      }
      // No start points — islandwide search.
      return scoreWithoutEtas(venue, profile, request.override_tags)
    } catch (err) {
      // Per-venue routing failures used to be silent; if every venue fails
      // (e.g. OneMap auth misconfigured) the whole plan returns 0 cards
      // with no signal. Log to Vercel Functions logs so the next breakage
      // is visible in 30 seconds, not via diagnostic Q&A.
      console.error(
        `[plan] routing failed for "${venue.name}" (${venue.lat},${venue.lng}):`,
        err instanceof Error ? err.message : String(err)
      )
      return null
    }
  })

  const ranked = routed.filter((r): r is NonNullable<typeof r> => r !== null)
  const buckets = bucketByCategory(ranked)
  const totalCards = buckets.dining.length + buckets.events.length

  return {
    buckets,
    meta: {
      source,
      fallback_reason,
      candidates_total: venues.length,
      after_local_filters: candidates.length,
      routed: ranked.length,
      candidate_cap: ROUTING_CANDIDATE_CAP,
      routing_concurrency: ROUTING_CONCURRENCY,
      cached_legs: cachedLegs,
      total_legs: needsRouting ? ranked.length * (startA && startB ? 2 : 1) : 0,
      total_cards: totalCards,
      outdoor_excluded: outdoorExcluded,
      starts_provided: (startA ? 1 : 0) + (startB ? 1 : 0),
      weather,
    },
  }
}

async function loadVenuesWithFallback(profile: Profile, overrides: string[]): Promise<VenueLoadResult> {
  return { venues: await loadFromSupabase(profile, overrides), source: 'supabase' }
}

async function loadFromSupabase(profile: Profile, overrides: string[]): Promise<Venue[]> {
  const supabase = await createClient()
  let query = supabase.from('venues').select('*').eq('active', true)
  if (profile.budget_bands && profile.budget_bands.length > 0) {
    query = query.in('budget_band', profile.budget_bands)
  }
  if (profile.dietary_hardstops.length > 0) {
    query = query.contains('dietary_flags', profile.dietary_hardstops)
  }
  if (overrides.includes('vegetarian')) {
    query = query.contains('dietary_flags', ['vegetarian_friendly'])
  }
  const { data, error } = await query
  if (error) throw new Error(`supabase: ${error.message}`)
  return (data ?? []) as Venue[]
}

function filterCandidates(
  venues: Venue[],
  profile: Profile,
  overrides: string[],
  weather: WeatherResult,
  scheduledDate: Date
): Venue[] {
  const avoided = new Set(profile.cuisines_avoided)
  return filterInMemory(venues, profile, overrides).filter((venue) => {
    if (venue.cuisine_tags.some((c) => avoided.has(c))) return false
    if (weather.condition === 'rain' && venue.is_outdoor) return false
    if (!isOpenAt(venue.hours_json, scheduledDate)) return false
    if (!isInRunWindow(venue, scheduledDate)) return false
    return true
  })
}

// Event rows record their run window in badge_meta.starts_at / ends_at
// (see bandsintownEventToVenue, museumEventToVenue, editorialEventToVenue,
// tslEventToVenue). When both are present, the planner rejects any
// scheduledDate that falls outside [starts_at, ends_at]. Date-only fields
// — interpret as inclusive day boundaries so a 14 May search still matches
// an event whose ends_at is 2026-05-14.
function isInRunWindow(venue: Venue, scheduledDate: Date): boolean {
  const meta = venue.badge_meta as Record<string, unknown> | null | undefined
  if (!meta) return true
  const startsRaw = typeof meta.starts_at === 'string' ? meta.starts_at : null
  const endsRaw = typeof meta.ends_at === 'string' ? meta.ends_at : null
  if (!startsRaw && !endsRaw) return true

  const t = scheduledDate.getTime()
  if (startsRaw) {
    const startTs = parseRunBoundary(startsRaw, 'start')
    if (Number.isFinite(startTs) && t < startTs) return false
  }
  if (endsRaw) {
    const endTs = parseRunBoundary(endsRaw, 'end')
    if (Number.isFinite(endTs) && t > endTs) return false
  }
  return true
}

// YYYY-MM-DD without a time is a date in SGT (event runs are stored
// in local terms). A bare date means start-of-day for `starts_at` and
// end-of-day (23:59:59.999) for `ends_at`. Full ISO timestamps parse
// directly. Returns NaN on parse failure so the caller falls open.
function parseRunBoundary(raw: string, kind: 'start' | 'end'): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const suffix = kind === 'start' ? 'T00:00:00+08:00' : 'T23:59:59.999+08:00'
    return new Date(raw + suffix).getTime()
  }
  return new Date(raw).getTime()
}

function filterInMemory(all: Venue[], profile: Profile, overrides: string[]): Venue[] {
  const budgetsAllowed =
    profile.budget_bands && profile.budget_bands.length > 0
      ? new Set(profile.budget_bands)
      : null
  return all.filter((venue) => {
    if (!venue.active) return false
    // Budget filter applies to dining only; experiences span budget_bands and
    // shouldn't be excluded just because the user picked $$ for restaurants.
    if (budgetsAllowed && !budgetsAllowed.has(venue.budget_band) && !venue.cuisine_tags.includes('experience')) {
      return false
    }
    if (!profile.dietary_hardstops.every((d) => venue.dietary_flags.includes(d))) return false
    if (overrides.includes('vegetarian') && !venue.dietary_flags.includes('vegetarian_friendly')) {
      return false
    }
    return true
  })
}

function emptyMeta(source: 'supabase', total: number) {
  return {
    source,
    candidates_total: total,
    after_local_filters: 0,
    routed: 0,
    candidate_cap: ROUTING_CANDIDATE_CAP,
  }
}

function emptyBuckets() {
  return { dining: [], events: [] }
}

const VIBE_TAGS = new Set(['cozy', 'adventurous', 'celebratory', 'low_key'])

// Reads the user's recent shortlist, derives the cuisine/vibe tags they've
// implicitly endorsed, and merges them into a working profile for this plan.
// Tags from explicit preferences win ties (we don't move avoided cuisines).
function applyShortlistAffinity(profile: Profile, shortlistIds: string[], venues: Venue[]): Profile {
  if (!shortlistIds || shortlistIds.length === 0) return profile

  const idSet = new Set(shortlistIds)
  const saved = venues.filter((v) => idSet.has(v.id))
  if (saved.length === 0) return profile

  const avoided = new Set(profile.cuisines_avoided)
  const cuisines = new Set(profile.cuisines_loved)
  for (const v of saved) {
    for (const c of v.cuisine_tags) {
      if (!avoided.has(c)) cuisines.add(c)
    }
  }

  const vibes = new Set<string>(profile.vibe_defaults)
  for (const v of saved) {
    for (const tag of v.vibe_tags) {
      if (VIBE_TAGS.has(tag)) vibes.add(tag)
    }
  }

  return {
    ...profile,
    cuisines_loved: [...cuisines],
    vibe_defaults: [...vibes] as Profile['vibe_defaults'],
  }
}
