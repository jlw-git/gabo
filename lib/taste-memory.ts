// Longitudinal taste memory (F5). A persistent, explainable per-device model of
// the couple's taste, built from their shortlist history. Unlike the stateless
// per-request applyShortlistAffinity, this REMEMBERS: every save appends a
// timestamped taste event (localStorage), and recent + repeated cuisine/vibe
// signals weigh more via exponential recency decay. The model survives a venue
// being un-shortlisted.
//
// SIGNED signals (F5 flesh-out): a save is a +1 event; a "Not for us" skip is a
// −1 event over the same tags. They aggregate into one signed weight per tag, so
// skips COUNTER saves — a cuisine you skip as often as you save never gets
// promoted into the inferred preferences. Skips deliberately never feed
// cuisines_avoided (a HARD filter in plan-date.ts): inferred taste must not be
// able to empty a result set. It only suppresses positive enrichment.
//
// Guardrail (AGENTIC_ROADMAP.md #2): taste affinity is DETERMINISTIC numeric
// aggregation over structured tags — no LLM. The model only ENRICHES the
// profile's preference tags (additive, never overriding); matchScore and the
// scoring formula are untouched. The optional LLM narration (see
// tasteNarrationPayload + /api/taste/narrate) only rewords the already-computed
// summary tags — it never scores, ranks, or sees the raw event log.

import { CUISINE_VOCAB, VIBE_VOCAB } from '@/lib/agents/vocab'
import type { Profile, VibeTag } from '@/lib/planner/types'

const KEY = 'gabo:taste-events-v1'
const MAX_EVENTS = 200 // cap the local log
const HALF_LIFE_DAYS = 60 // recency decay; a save 60d old counts half as much
const MS_PER_DAY = 86_400_000

const TOP_CUISINES = 3
const TOP_VIBES = 2
const MIN_WEIGHT = 0.5 // ignore tags below this (≈ one save older than a half-life)
const NEG_WEIGHT = -MIN_WEIGHT // an "easing off" signal needs the mirror conviction
const MIN_EVENTS_FOR_SUMMARY = 2
const TOP_EASING_OFF = 1

const CUISINE_SET = new Set<string>(CUISINE_VOCAB)
const VIBE_SET = new Set<string>(VIBE_VOCAB)

// +1 = saved (shortlisted), −1 = skipped ("Not for us"). Stored explicitly so a
// future polarity can't silently re-read as positive.
export type Polarity = 1 | -1

export type TasteEvent = {
  at: string
  cuisines: string[]
  vibes: string[]
  // Optional for back-compat: events written before signed signals existed have
  // no polarity and are read as +1 (saves).
  polarity?: Polarity
}

export type TasteAffinity = {
  // Signed, descending: positive = leaning toward, negative = easing off.
  cuisines: { tag: string; weight: number }[]
  vibes: { tag: string; weight: number }[]
  eventCount: number
  negativeCount: number
}

// Compact, on-device-computed summary that is the ONLY thing the optional LLM
// narration sends off-device — the top tags, never the raw event log. null below
// the signal floor.
export type TasteNarrationPayload = {
  loved: string[]
  vibes: string[]
  easingOff: string[]
}

export function loadTasteEvents(): TasteEvent[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is TasteEvent =>
        !!e &&
        typeof e === 'object' &&
        typeof e.at === 'string' &&
        Array.isArray(e.cuisines) &&
        Array.isArray(e.vibes) &&
        (e.polarity === undefined || e.polarity === 1 || e.polarity === -1)
    )
  } catch {
    return []
  }
}

// Append a taste event from a venue's tags. `polarity` is +1 for a save and −1
// for a "Not for us" skip. Drops the 'experience' category marker (it's not a
// cuisine) and clamps to the known vocab so the model can only ever influence
// the profile with values matchScore understands.
export function recordTasteEvent(
  cuisineTags: string[],
  vibeTags: string[],
  polarity: Polarity = 1
): void {
  if (typeof window === 'undefined') return
  const cuisines = [...new Set(cuisineTags)].filter((c) => CUISINE_SET.has(c))
  const vibes = [...new Set(vibeTags)].filter((v) => VIBE_SET.has(v))
  if (cuisines.length === 0 && vibes.length === 0) return
  try {
    const events = loadTasteEvents()
    events.push({ at: new Date().toISOString(), cuisines, vibes, polarity })
    const trimmed = events.slice(-MAX_EVENTS)
    window.localStorage.setItem(KEY, JSON.stringify(trimmed))
  } catch {
    /* quota / private mode — silently drop */
  }
}

export function clearTasteEvents(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

function recencyWeight(at: string, now: number): number {
  const ageDays = Math.max(0, (now - new Date(at).getTime()) / MS_PER_DAY)
  if (!Number.isFinite(ageDays)) return 0
  return Math.exp((-ageDays / HALF_LIFE_DAYS) * Math.LN2)
}

// Pure: aggregate signed recency-weighted affinity per cuisine + vibe tag,
// ranked desc. Each event contributes `recency × polarity`, so a skip subtracts
// the same magnitude a same-day save would add.
export function computeTasteAffinity(events: TasteEvent[], now: number): TasteAffinity {
  const cuisineW = new Map<string, number>()
  const vibeW = new Map<string, number>()
  let negativeCount = 0
  for (const e of events) {
    const w = recencyWeight(e.at, now)
    if (w <= 0) continue
    const signed = w * (e.polarity ?? 1)
    if ((e.polarity ?? 1) < 0) negativeCount += 1
    for (const c of e.cuisines) if (CUISINE_SET.has(c)) cuisineW.set(c, (cuisineW.get(c) ?? 0) + signed)
    for (const v of e.vibes) if (VIBE_SET.has(v)) vibeW.set(v, (vibeW.get(v) ?? 0) + signed)
  }
  const rank = (m: Map<string, number>) =>
    [...m.entries()].map(([tag, weight]) => ({ tag, weight })).sort((a, b) => b.weight - a.weight)
  return {
    cuisines: rank(cuisineW),
    vibes: rank(vibeW),
    eventCount: events.length,
    negativeCount,
  }
}

// Pure: additively inject the top recency-weighted tags into the profile.
// Never overrides explicit selections; respects cuisines_avoided. Because the
// weights are SIGNED, a tag the user skips as often as they save nets below
// MIN_WEIGHT and is silently dropped — skips suppress promotion, they never
// inject an avoid (that stays an explicit, user-only hard filter).
export function enrichProfileWithTaste(
  profile: Profile,
  events: TasteEvent[],
  now: number
): Profile {
  const aff = computeTasteAffinity(events, now)
  const avoided = new Set(profile.cuisines_avoided)

  const lovedAdds = aff.cuisines
    .filter((c) => c.weight >= MIN_WEIGHT && !avoided.has(c.tag))
    .slice(0, TOP_CUISINES)
    .map((c) => c.tag)
  const vibeAdds = aff.vibes
    .filter((v) => v.weight >= MIN_WEIGHT)
    .slice(0, TOP_VIBES)
    .map((v) => v.tag as VibeTag)

  if (lovedAdds.length === 0 && vibeAdds.length === 0) return profile

  return {
    ...profile,
    cuisines_loved: [...new Set([...profile.cuisines_loved, ...lovedAdds])],
    vibe_defaults: [...new Set([...profile.vibe_defaults, ...vibeAdds])],
  }
}

const VIBE_LABEL: Record<string, string> = {
  cozy: 'cozy',
  adventurous: 'adventurous',
  celebratory: 'celebratory',
  low_key: 'low-key',
}

function prettyCuisine(tag: string): string {
  return tag.replace(/_/g, ' ')
}

// Templated, deterministic explanation. null below the signal floor. This is
// the always-available fallback the LLM narration degrades to.
export function tasteSummary(aff: TasteAffinity): string | null {
  if (aff.eventCount < MIN_EVENTS_FOR_SUMMARY) return null
  const vibes = aff.vibes.filter((v) => v.weight >= MIN_WEIGHT).slice(0, 1).map((v) => VIBE_LABEL[v.tag] ?? v.tag)
  const cuisines = aff.cuisines
    .filter((c) => c.weight >= MIN_WEIGHT)
    .slice(0, 2)
    .map((c) => prettyCuisine(c.tag))
  // Most net-negative cuisine, if conviction passes the floor — surfaced as a
  // gentle "easing off" rather than a hard avoid.
  const easingOff = aff.cuisines
    .filter((c) => c.weight <= NEG_WEIGHT)
    .slice(-TOP_EASING_OFF)
    .map((c) => prettyCuisine(c.tag))
  if (vibes.length === 0 && cuisines.length === 0 && easingOff.length === 0) return null

  const parts: string[] = []
  if (vibes.length) parts.push(vibes[0])
  if (cuisines.length === 1) parts.push(cuisines[0])
  else if (cuisines.length === 2) parts.push(`${cuisines[0]} and ${cuisines[1]}`)

  const lean = parts.length ? `Leaning ${parts.join(' · ')}` : ''
  const ease = easingOff.length ? `easing off ${easingOff[0]}` : ''
  const head = [lean, ease].filter(Boolean).join(', ')
  return `${head} — from your saves`
}

// Build the off-device narration input from the on-device affinity. Returns the
// same top tags tasteSummary surfaces — never timestamps, counts, or venue
// identity. null below the signal floor (so callers skip the network call).
export function tasteNarrationPayload(aff: TasteAffinity): TasteNarrationPayload | null {
  if (aff.eventCount < MIN_EVENTS_FOR_SUMMARY) return null
  const loved = aff.cuisines
    .filter((c) => c.weight >= MIN_WEIGHT)
    .slice(0, TOP_CUISINES)
    .map((c) => prettyCuisine(c.tag))
  const vibes = aff.vibes
    .filter((v) => v.weight >= MIN_WEIGHT)
    .slice(0, TOP_VIBES)
    .map((v) => VIBE_LABEL[v.tag] ?? v.tag)
  const easingOff = aff.cuisines
    .filter((c) => c.weight <= NEG_WEIGHT)
    .slice(-TOP_EASING_OFF)
    .map((c) => prettyCuisine(c.tag))
  if (loved.length === 0 && vibes.length === 0 && easingOff.length === 0) return null
  return { loved, vibes, easingOff }
}
