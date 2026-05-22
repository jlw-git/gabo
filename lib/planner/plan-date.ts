import { decideRelaxation, MIN_HEALTHY_RESULTS } from '@/lib/agents/relaxation'
import { rerankBuckets } from '@/lib/agents/ranker'
import { mapWithConcurrency } from '@/lib/async/pool'
import { fetchDriveRoute, type DriveRouteResult } from '@/lib/onemap/client'
import { evaluateCandidates } from '@/lib/planner/gemini-eval'
import { isVenueOpenAt } from '@/lib/planner/hours'
import type { PlanRequest } from '@/lib/planner/request-validation'
import {
  bucketByCategory,
  type Buckets,
  prescore,
  scoreWithETAs,
  scoreWithSingleEta,
  scoreWithoutEtas,
} from '@/lib/planner/score'
import type { LatLng, PlanCard, Profile, RankedVenue, Venue } from '@/lib/planner/types'
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

  const routeResult = await routeAndScore(
    topByPrescore,
    profile,
    request.override_tags,
    startA,
    startB,
    getDirection
  )
  let { ranked, cachedLegs } = routeResult
  let buckets = bucketByCategory(ranked)

  // Phase 4 — agentic relaxation. When a bucket comes back thin, ask the
  // LLM whether to widen the search by dropping SOFT constraints
  // (cuisine avoidance, budget filter, distance cap, loved-cuisine boost).
  // Hard filters never relax. Gated by AGENTIC_PLAN_ENABLED so the
  // pre-Phase-4 behaviour is the default until we measure the new path.
  const relaxationMeta: {
    bucket: 'dining' | 'events'
    dropped: string[]
    reason: string
    delta: number
  }[] = []
  if (
    process.env.AGENTIC_PLAN_ENABLED === 'true' &&
    (buckets.dining.length < MIN_HEALTHY_RESULTS ||
      buckets.events.length < MIN_HEALTHY_RESULTS)
  ) {
    const relaxedOutcome = await relaxAndRetry({
      venues,
      candidates,
      buckets,
      profile,
      request,
      weather,
      scheduledDate,
      startA,
      startB,
      getDirection,
    })
    if (relaxedOutcome) {
      ranked = relaxedOutcome.ranked
      cachedLegs += relaxedOutcome.extraCachedLegs
      buckets = relaxedOutcome.buckets
      relaxationMeta.push(...relaxedOutcome.relaxationMeta)
    }
  }

  // Phase 5 — LLM-augmented ranker. Re-orders WITHIN A TOLERANCE BAND
  // (max ±3 positions per card; top-of-formula can't fall below #3) and
  // stamps a per-card rank_reason. Gated separately so we can ship
  // relaxation without the ranker and vice versa.
  let rerankedDining = 0
  let rerankedEvents = 0
  if (process.env.AGENTIC_RANKER_ENABLED === 'true') {
    const out = await rerankBuckets(buckets, profile, weather, scheduledDate, request.override_tags)
    buckets = out.buckets
    rerankedDining = out.reranked_dining
    rerankedEvents = out.reranked_events
  }

  const totalCards = buckets.dining.length + buckets.events.length

  // Gemini copy enrichment. evaluateCandidates() carries its own 8s timeout +
  // graceful fallback, so we await it on the critical path — the worst case
  // adds ~3s in normal operation, less if the Map comes back empty. The cards
  // remain usable either way: PlanCard falls back to formula-derived body
  // copy when `why` is absent (see components/PlanCard.tsx).
  const allCards: PlanCard[] = [...buckets.dining, ...buckets.events]
  const whyMap = await evaluateCandidates(
    allCards,
    profile,
    weather,
    scheduledDate,
    request.override_tags
  )
  if (whyMap.size > 0) {
    const stamp = (c: PlanCard): PlanCard => {
      const why = whyMap.get(c.id)
      return why ? { ...c, why } : c
    }
    buckets.dining = buckets.dining.map(stamp)
    buckets.events = buckets.events.map(stamp)
  }

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
      gemini_enriched: whyMap.size,
      // Phase 4 — what the relaxation agent dropped (per bucket) and how
      // many extra cards each relaxation surfaced. UI surfaces this as a
      // "We widened the search because…" pill below the results header.
      agent_relaxation: relaxationMeta,
      // Phase 5 — how many cards the ranker successfully re-positioned
      // (within the tolerance band) per bucket. 0 means the ranker either
      // ran and accepted formula order, or the env flag is off / it failed.
      ranker: { dining: rerankedDining, events: rerankedEvents },
    },
  }
}

// Routing + per-venue scoring. Pulled out of the planDate body so the
// relaxation path can call it twice — once with the original filter set,
// once with the agent-chosen widening applied.
async function routeAndScore(
  venues: Venue[],
  profile: Profile,
  overrideTags: string[],
  startA: LatLng | null,
  startB: LatLng | null,
  getDirection: (origin: LatLng, destination: LatLng) => Promise<DriveRouteResult>
): Promise<{ ranked: RankedVenue[]; cachedLegs: number }> {
  let cachedLegs = 0
  const routed = await mapWithConcurrency(venues, ROUTING_CONCURRENCY, async (venue) => {
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
          overrideTags
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
          overrideTags
        )
      }
      // No start points — islandwide search.
      return scoreWithoutEtas(venue, profile, overrideTags)
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
  return { ranked, cachedLegs }
}

// Relaxation pass. Called only when at least one bucket came back below
// MIN_HEALTHY_RESULTS. Runs the relaxation agent, applies its toggles to
// a working copy of the filter+score pipeline, and returns the widened
// buckets IF they actually grew. If the agent declines to relax (or the
// widened pass doesn't surface more cards), the original result wins.
type RelaxAndRetryDeps = {
  venues: Venue[]
  candidates: Venue[]
  buckets: Buckets
  profile: Profile
  request: PlanRequest
  weather: WeatherResult
  scheduledDate: Date
  startA: LatLng | null
  startB: LatLng | null
  getDirection: (origin: LatLng, destination: LatLng) => Promise<DriveRouteResult>
}

async function relaxAndRetry(deps: RelaxAndRetryDeps): Promise<{
  ranked: RankedVenue[]
  buckets: Buckets
  extraCachedLegs: number
  relaxationMeta: { bucket: 'dining' | 'events'; dropped: string[]; reason: string; delta: number }[]
} | null> {
  // Ask the agent — once per thin bucket. We ask each bucket separately so
  // dining can relax cuisine while events relaxes distance, say.
  const thin: ('dining' | 'events')[] = []
  if (deps.buckets.dining.length < MIN_HEALTHY_RESULTS) thin.push('dining')
  if (deps.buckets.events.length < MIN_HEALTHY_RESULTS) thin.push('events')
  if (thin.length === 0) return null

  const decisions = await Promise.all(
    thin.map(async (bucket) => ({
      bucket,
      decision: await decideRelaxation({
        bucket,
        initial_count: deps.buckets[bucket].length,
        profile: deps.profile,
        override_tags: deps.request.override_tags,
        weather_condition: deps.weather.condition,
        prefilter_total: deps.candidates.length,
      }),
    }))
  )

  // Union the toggled flags across all thin buckets — one widened pass
  // handles both. (If dining wants cuisine_avoidance dropped and events
  // wants distance_cap dropped, we drop both; each bucket gets its own
  // metadata note explaining what was widened for it.)
  const union = decisions.reduce(
    (acc, { decision }) => ({
      drop_cuisine_avoidance: acc.drop_cuisine_avoidance || decision.drop_cuisine_avoidance,
      drop_budget_filter: acc.drop_budget_filter || decision.drop_budget_filter,
      drop_distance_cap: acc.drop_distance_cap || decision.drop_distance_cap,
      drop_match_boost: acc.drop_match_boost || decision.drop_match_boost,
    }),
    { drop_cuisine_avoidance: false, drop_budget_filter: false, drop_distance_cap: false, drop_match_boost: false }
  )
  const anyToggled =
    union.drop_cuisine_avoidance ||
    union.drop_budget_filter ||
    union.drop_distance_cap ||
    union.drop_match_boost
  if (!anyToggled) return null

  // Build a relaxed profile + override set.
  const relaxedProfile: Profile = {
    ...deps.profile,
    cuisines_avoided: union.drop_cuisine_avoidance ? [] : deps.profile.cuisines_avoided,
    budget_bands: union.drop_budget_filter ? [] : deps.profile.budget_bands,
    cuisines_loved: union.drop_match_boost ? [] : deps.profile.cuisines_loved,
  }

  const relaxedCandidates = filterCandidates(
    deps.venues,
    relaxedProfile,
    deps.request.override_tags,
    deps.weather,
    deps.scheduledDate
  )
  const relaxedTop = [...relaxedCandidates]
    .sort((a, b) => prescore(b, relaxedProfile) - prescore(a, relaxedProfile))
    .slice(0, ROUTING_CANDIDATE_CAP)

  if (relaxedTop.length <= deps.candidates.length) {
    // No new prefilter survivors → nothing to gain.
    return null
  }

  const relaxedRoute = await routeAndScore(
    relaxedTop,
    relaxedProfile,
    deps.request.override_tags,
    deps.startA,
    deps.startB,
    deps.getDirection
  )

  // bucketByCategory applies the 60-min ETA cap. The relaxation toggle
  // drop_distance_cap means "raise that cap" — implement by widening the
  // post-bucket pool to include over-60-min cards when the toggle fires.
  // We do this by short-circuiting bucketByCategory with our own pool.
  const widenedBuckets = union.drop_distance_cap
    ? bucketWithoutEtaCap(relaxedRoute.ranked)
    : bucketByCategory(relaxedRoute.ranked)

  // Only accept the relaxed pass if at least one bucket actually grew.
  const diningGain = widenedBuckets.dining.length - deps.buckets.dining.length
  const eventsGain = widenedBuckets.events.length - deps.buckets.events.length
  if (diningGain <= 0 && eventsGain <= 0) return null

  const relaxationMeta = decisions
    .map(({ bucket, decision }) => {
      const dropped: string[] = []
      if (decision.drop_cuisine_avoidance) dropped.push('cuisine_avoidance')
      if (decision.drop_budget_filter) dropped.push('budget_filter')
      if (decision.drop_distance_cap) dropped.push('distance_cap')
      if (decision.drop_match_boost) dropped.push('match_boost')
      const delta = bucket === 'dining' ? diningGain : eventsGain
      return { bucket, dropped, reason: decision.reason, delta }
    })
    .filter((m) => m.dropped.length > 0 && m.delta > 0)

  return {
    ranked: relaxedRoute.ranked,
    buckets: widenedBuckets,
    extraCachedLegs: relaxedRoute.cachedLegs,
    relaxationMeta,
  }
}

// Variant of bucketByCategory used ONLY by the relaxation path when the
// agent has opted to drop the distance cap. We bypass the 60-min ETA filter
// but keep the per-category cap + dedup + score sort intact. Importing
// score.ts internals here would be cleaner, but a small local pool keeps
// the change isolated.
function bucketWithoutEtaCap(ranked: RankedVenue[]): Buckets {
  // Defer to the standard bucketing for everything except the ETA filter —
  // do it by spoofing zero ETAs (which is what bucketByCategory treats as
  // "no routing", i.e. always-reachable).
  const fakeUnranked = ranked.map((r) => ({ ...r, eta_a_min: 0, eta_b_min: 0 }))
  const out = bucketByCategory(fakeUnranked)
  // Restore real ETAs from the original list (keyed by venue id).
  const realEtas = new Map(ranked.map((r) => [r.id, { a: r.eta_a_min, b: r.eta_b_min }]))
  const restore = (c: PlanCard): PlanCard => {
    const etas = realEtas.get(c.id)
    return etas ? { ...c, eta_a_min: etas.a, eta_b_min: etas.b } : c
  }
  return {
    dining: out.dining.map(restore),
    events: out.events.map(restore),
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
  if (overrides.includes('no_alcohol')) {
    query = query.contains('dietary_flags', ['alcohol_free'])
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
    if (!isVenueOpenAt(venue, scheduledDate)) return false
    if (!isInRunWindow(venue, scheduledDate)) return false
    return true
  })
}

// Event rows record their run window in badge_meta.starts_at / ends_at
// (see museumEventToVenue, editorialEventToVenue, tslEventToVenue).
// When both are present, the planner rejects any
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
    if (overrides.includes('no_alcohol') && !venue.dietary_flags.includes('alcohol_free')) {
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
