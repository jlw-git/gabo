import { mapWithConcurrency } from '@/lib/async/pool'
import { fetchDirection, type DirectionResult } from '@/lib/grabmaps/direction'
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
import { catalog } from '@/lib/venues/catalog'
import { fetchWeatherCondition, type WeatherResult } from '@/lib/weather'

// Cap on how many candidates we route after hard-filtering. Each survivor
// costs up to 2 GrabMaps Direction calls. Sized generously since with two
// categories (dining + events) we want depth in both.
const ROUTING_CANDIDATE_CAP = 24
const ROUTING_CONCURRENCY = 5

type VenueSource = 'supabase' | 'catalog' | 'catalog-fallback'

type VenueLoadResult = {
  venues: Venue[]
  source: VenueSource
  fallback_reason?: string
}

export type PlanDateDeps = {
  loadVenues?: (profile: Profile, overrides: string[]) => Promise<VenueLoadResult>
  getWeather?: (at: Date) => Promise<WeatherResult>
  getDirection?: (origin: LatLng, destination: LatLng) => Promise<DirectionResult>
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
  const getDirection = deps.getDirection ?? fetchDirection
  const hasRoutingApiKey = deps.hasRoutingApiKey ?? (() => Boolean(process.env.GRABMAPS_API_KEY))

  const weather = await getWeather(scheduledDate)
  const { venues, source, fallback_reason } = await loadVenues(request.profile, request.override_tags)
  const candidates = filterCandidates(venues, request.profile, request.override_tags, weather, scheduledDate)

  const topByPrescore = [...candidates]
    .sort((a, b) => prescore(b, request.profile) - prescore(a, request.profile))
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
    throw new PlanDateError('GRABMAPS_API_KEY missing', 500)
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
          request.profile,
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
          request.profile,
          Math.round(a.duration_sec / 60),
          request.override_tags
        )
      }
      // No start points — islandwide search.
      return scoreWithoutEtas(venue, request.profile, request.override_tags)
    } catch {
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
      starts_provided: (startA ? 1 : 0) + (startB ? 1 : 0),
      weather,
    },
  }
}

async function loadVenuesWithFallback(profile: Profile, overrides: string[]): Promise<VenueLoadResult> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return { venues: filterInMemory(catalog, profile, overrides), source: 'catalog' }
  }
  try {
    return { venues: await loadFromSupabase(profile, overrides), source: 'supabase' }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown supabase error'
    return {
      venues: filterInMemory(catalog, profile, overrides),
      source: 'catalog-fallback',
      fallback_reason: message,
    }
  }
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
    return true
  })
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

function emptyMeta(source: VenueSource, total: number) {
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
