// Whole-evening itinerary composition (F2).
//
// Composes a sequenced evening — one dinner + one activity, ordered, with the
// travel leg between them — from the candidates the deterministic planner
// already scored and filtered (the dining + events buckets).
//
// Guardrail (AGENTIC_ROADMAP.md principle #2): FEASIBILITY IS DETERMINISTIC.
// Timing (does the activity stay open until you arrive?) and reachability (how
// long is the leg?) are decided in code here. The LLM only picks the nicest
// feasible evening and writes the one-line pacing note — it can't add a venue,
// change a score, or override feasibility.

import { COPY_MODEL } from '@/lib/agents/models'
import { recordRun } from '@/lib/agents/run-log'
import { generateJson } from '@/lib/agents/runner'
import { distanceKm } from '@/lib/distance'
import { isVenueOpenForMeal } from '@/lib/planner/hours'
import { fetchDriveRoute, fetchTransitRoute } from '@/lib/onemap/client'
import type { PlanCard, TransitMode } from '@/lib/planner/types'

// Dwell times (minutes) and bounds. Conservative defaults; tunable later.
const DINNER_DWELL_MIN = 90
const ACTIVITY_DWELL_MIN = 45
const NIGHTCAP_DWELL_MIN = 45
const MAX_PER_ROLE = 4 // top-N dinners × top-N activities considered
const MAX_PAIRS_TO_ROUTE = 8 // bound OneMap calls per compose
const MAX_NIGHTCAP_TO_ROUTE = 2 // bound nightcap routing per evening
const LEG_MAX_MIN = 45 // a leg longer than this isn't a pleasant evening
const KEEP_FEASIBLE = 5 // hand at most this many to the LLM

// A nightcap (optional 3rd stop) is a dining venue tagged for drinks or dessert.
const DRINK_TAGS = new Set(['bar', 'cocktail'])
const DESSERT_TAGS = new Set(['cafe', 'dessert', 'bakery'])

export type ItineraryStop = {
  card: PlanCard
  role: 'dinner' | 'activity' | 'nightcap'
  arrive: string // ISO; formatted client-side
  dwell_min: number
}

export type ItineraryLeg = {
  mode: TransitMode
  duration_min: number
  // Drive-route geometry [lng,lat][] for the map polyline; absent on failure.
  path?: [number, number][]
}

export type Itinerary = {
  stops: ItineraryStop[]
  legs: ItineraryLeg[] // one per gap (stops.length - 1)
  total_min: number
  why?: string
}

function nightcapKind(card: PlanCard): 'drinks' | 'dessert' | null {
  const tags = card.cuisine_tags
  if (tags.some((t) => DRINK_TAGS.has(t))) return 'drinks'
  if (tags.some((t) => DESSERT_TAGS.has(t))) return 'dessert'
  return null
}

export type ComposeInput = {
  dining: PlanCard[]
  events: PlanCard[]
  scheduledFor: Date
  mode: TransitMode
}

function addMinutes(d: Date, min: number): Date {
  return new Date(d.getTime() + min * 60_000)
}

type Feasible = {
  dinner: PlanCard
  activity: PlanCard
  legMin: number
  order: 'dinner_first' | 'activity_first'
  dinnerArrive: Date
  activityArrive: Date
  rank: number
}

// Route the leg between two venues for the given mode. Returns minutes, or null
// if routing fails (caller drops the pair).
async function legMinutes(
  a: PlanCard,
  b: PlanCard,
  mode: TransitMode,
  departAt: Date
): Promise<number | null> {
  try {
    if (mode === 'transit') {
      const r = await fetchTransitRoute({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }, departAt)
      return Math.round(r.duration_sec / 60)
    }
    const r = await fetchDriveRoute({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng })
    return Math.round(r.duration_sec / 60)
  } catch {
    return null
  }
}

export async function composeItinerary(input: ComposeInput): Promise<Itinerary[]> {
  const dinners = input.dining.slice(0, MAX_PER_ROLE)
  const activities = input.events.slice(0, MAX_PER_ROLE)
  if (dinners.length === 0 || activities.length === 0) return []

  // Pre-rank pairs by straight-line proximity so we only spend routing calls on
  // the most plausible evenings.
  const pairs = dinners
    .flatMap((dinner) => activities.map((activity) => ({ dinner, activity })))
    .map((p) => ({ ...p, km: distanceKm(p.dinner, p.activity) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, MAX_PAIRS_TO_ROUTE)

  // The leg is routed once per pair at the forward (dinner→activity) departure
  // time; reused for the reverse ordering as a close approximation.
  const forwardDepart = addMinutes(input.scheduledFor, DINNER_DWELL_MIN)
  const routed = await Promise.all(
    pairs.map(async (p) => ({
      ...p,
      legMin: await legMinutes(p.dinner, p.activity, input.mode, forwardDepart),
    }))
  )

  const feasible: Feasible[] = []
  for (const p of routed) {
    if (p.legMin == null || p.legMin > LEG_MAX_MIN) continue
    const start = input.scheduledFor

    // Forward: dinner now, then activity after dinner + leg.
    const fwdActivityArrive = addMinutes(start, DINNER_DWELL_MIN + p.legMin)
    const forwardOk =
      isVenueOpenForMeal(p.dinner, start, DINNER_DWELL_MIN) &&
      isVenueOpenForMeal(p.activity, fwdActivityArrive, ACTIVITY_DWELL_MIN)

    // Reverse: activity now, then dinner after activity + leg. Lets an
    // early-closing exhibition still pair with a later dinner.
    const revDinnerArrive = addMinutes(start, ACTIVITY_DWELL_MIN + p.legMin)
    const reverseOk =
      isVenueOpenForMeal(p.activity, start, ACTIVITY_DWELL_MIN) &&
      isVenueOpenForMeal(p.dinner, revDinnerArrive, DINNER_DWELL_MIN)

    const order: Feasible['order'] | null = forwardOk
      ? 'dinner_first'
      : reverseOk
        ? 'activity_first'
        : null
    if (!order) continue

    // Composite: the two venues' existing scores + a short-leg bonus. The
    // deterministic scores already encode fairness/match/freshness.
    const rank =
      p.dinner.score + p.activity.score + ((LEG_MAX_MIN - p.legMin) / LEG_MAX_MIN) * 0.2

    feasible.push({
      dinner: p.dinner,
      activity: p.activity,
      legMin: p.legMin,
      order,
      dinnerArrive: order === 'dinner_first' ? start : revDinnerArrive,
      activityArrive: order === 'dinner_first' ? fwdActivityArrive : start,
      rank,
    })
  }

  if (feasible.length === 0) {
    void recordRun('itinerary', { feasible: 0, mode: input.mode })
    return []
  }

  feasible.sort((a, b) => b.rank - a.rank)
  const top = feasible.slice(0, KEEP_FEASIBLE)

  const built = top.map((f) => toItinerary(f, input.mode))

  // Optionally extend each evening with a nightcap (drinks/dessert) when feasible.
  const withNightcaps = await Promise.all(
    built.map((it) => appendNightcap(it, input.dining, input.mode))
  )

  // LLM selection + copy over the feasible set. Picks the best up to 3 and
  // writes a "why this evening flows" line. Falls back to the deterministic
  // top-3 with formula copy on any failure.
  const chosen = await selectAndNarrate(withNightcaps)

  // Fetch route geometry only for the few itineraries we'll actually show.
  const enriched = await enrichGeometry(chosen)

  void recordRun('itinerary', {
    feasible: feasible.length,
    returned: enriched.length,
    three_stop: enriched.filter((it) => it.stops.length === 3).length,
    mode: input.mode,
  })
  return enriched
}

function toItinerary(f: Feasible, mode: TransitMode): Itinerary {
  const dinnerStop: ItineraryStop = {
    card: f.dinner,
    role: 'dinner',
    arrive: f.dinnerArrive.toISOString(),
    dwell_min: DINNER_DWELL_MIN,
  }
  const activityStop: ItineraryStop = {
    card: f.activity,
    role: 'activity',
    arrive: f.activityArrive.toISOString(),
    dwell_min: ACTIVITY_DWELL_MIN,
  }
  const stops =
    f.order === 'dinner_first' ? [dinnerStop, activityStop] : [activityStop, dinnerStop]
  return {
    stops,
    legs: [{ mode, duration_min: f.legMin }],
    total_min: DINNER_DWELL_MIN + ACTIVITY_DWELL_MIN + f.legMin,
    why: formulaWhy(stops),
  }
}

function formulaWhy(stops: ItineraryStop[]): string {
  return `${stops.map((s) => s.card.name).join(', then ')}.`
}

// Try to append a nightcap (drinks/dessert) after the evening's last stop.
// Deterministic feasibility: open on arrival + a short reachable leg. Returns
// the 3-stop itinerary when feasible, else the original 2-stop one.
async function appendNightcap(
  it: Itinerary,
  dining: PlanCard[],
  mode: TransitMode
): Promise<Itinerary> {
  const last = it.stops[it.stops.length - 1]
  const lastEnd = addMinutes(new Date(last.arrive), last.dwell_min)
  const used = new Set(it.stops.map((s) => s.card.id))

  const candidates = dining
    .filter((c) => !used.has(c.id) && nightcapKind(c) !== null)
    .map((c) => ({ c, km: distanceKm(last.card, c) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, MAX_NIGHTCAP_TO_ROUTE)

  for (const { c } of candidates) {
    const legMin = await legMinutes(last.card, c, mode, lastEnd)
    if (legMin == null || legMin > LEG_MAX_MIN) continue
    const arrive = addMinutes(lastEnd, legMin)
    if (!isVenueOpenForMeal(c, arrive, NIGHTCAP_DWELL_MIN)) continue
    const stops = [
      ...it.stops,
      { card: c, role: 'nightcap' as const, arrive: arrive.toISOString(), dwell_min: NIGHTCAP_DWELL_MIN },
    ]
    return {
      stops,
      legs: [...it.legs, { mode, duration_min: legMin }],
      total_min: it.total_min + legMin + NIGHTCAP_DWELL_MIN,
      why: formulaWhy(stops),
    }
  }
  return it
}

// Fetch drive-route geometry for each leg of the chosen itineraries (bounded:
// only what we'll show). Used for the map polyline; straight-line fallback in
// the view when a path is absent.
async function enrichGeometry(its: Itinerary[]): Promise<Itinerary[]> {
  return Promise.all(
    its.map(async (it) => {
      const legs = await Promise.all(
        it.legs.map(async (leg, i) => {
          try {
            const r = await fetchDriveRoute(
              { lat: it.stops[i].card.lat, lng: it.stops[i].card.lng },
              { lat: it.stops[i + 1].card.lat, lng: it.stops[i + 1].card.lng }
            )
            const coords = r.geometry?.coordinates as [number, number][] | undefined
            return coords && coords.length > 1 ? { ...leg, path: coords } : leg
          } catch {
            return leg
          }
        })
      )
      return { ...it, legs }
    })
  )
}

async function selectAndNarrate(built: Itinerary[]): Promise<Itinerary[]> {
  if (built.length === 0) return built
  const list = built
    .map(
      (it, i) =>
        `${i}: ${it.stops.map((s) => `${s.card.name} (${s.role})`).join(' → ')}`
    )
    .join('\n')

  const prompt = `You are picking the best date-night evenings for a Singapore couple. Each option below is a feasible evening — dinner + an activity, sometimes with a drinks/dessert nightcap — that the planner already verified for timing and travel. Choose the best 1-3 and write a short, warm one-sentence reason each (max ~18 words) describing how the evening flows.

Options:
${list}

Return ONLY JSON: {"picks":[{"index":0,"why":"..."}]}. Use only the indices shown, best first.`

  const out = await generateJson<{ picks: { index: number; why: string }[] }>({
    model: COPY_MODEL,
    prompt,
    timeoutMs: 8000,
  })

  if (!out || !Array.isArray(out.picks) || out.picks.length === 0) {
    return built.slice(0, 3) // deterministic fallback with formula copy
  }

  const seen = new Set<number>()
  const picked: Itinerary[] = []
  for (const p of out.picks) {
    if (!Number.isInteger(p.index) || p.index < 0 || p.index >= built.length) continue
    if (seen.has(p.index)) continue
    seen.add(p.index)
    const why = typeof p.why === 'string' && p.why.trim() ? p.why.trim().slice(0, 160) : undefined
    picked.push({ ...built[p.index], why: why ?? built[p.index].why })
    if (picked.length >= 3) break
  }
  return picked.length > 0 ? picked : built.slice(0, 3)
}
