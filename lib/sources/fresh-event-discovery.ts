// Grounded fresh-event discovery.
//
// This is the "good human planner" gap: fast-moving pop-ups, viral art
// installations, weekend markets, and newly announced limited runs often land
// in search/editorial/social chatter before slower venue feeds catch up. This
// agent proposes candidates from current web signals, but deterministic code
// decides whether a row is safe enough to upsert.

import { EXTRACTION_MODEL } from '@/lib/agents/models'
import { chatComplete } from '@/lib/agents/provider'
import type { GeminiUsageFeature } from '@/lib/agents/gemini-usage-log'
import { searchPlaces } from '@/lib/onemap/client'
import type { HoursJson } from '@/lib/planner/types'
import type { EditorialEvent } from './editorial-events'

const CATEGORY_TAGS = [
  'art',
  'exhibition',
  'immersive',
  'festival',
  'market',
  'pop_up',
  'music',
  'theatre',
  'film',
  'food',
  'nightlife',
  'workshop',
  'family',
] as const

const VIBE_TAGS = ['cozy', 'adventurous', 'celebratory', 'low_key'] as const
const MAX_DISCOVERED_EVENTS = 10
const MAX_RUN_DAYS = 120
const LOOKAHEAD_DAYS = 45

export type FreshEventDiscoverySummary = {
  proposed: number
  accepted: number
  rejected: number
  errors: string[]
  events: EditorialEvent[]
}

type RawFreshEvent = {
  name: string
  source_url: string
  venue_name: string
  venue_address: string
  starts_at: string
  ends_at: string
  opens_at: string | null
  closes_at: string | null
  category_tags: string[]
  vibe_tags: string[]
  is_outdoor: boolean
  why_trending: string
  trend_strength: number
}

export type FreshEventDiscoveryOptions = {
  /** Fail closed for a refresh: malformed output or failed verification is not freshness. */
  strict?: boolean
  signal?: AbortSignal
  singleAttempt?: boolean
  feature?: GeminiUsageFeature
  maxOutputTokens?: number
  thinkingBudget?: number
}

export async function discoverFreshEvents(
  now = new Date(),
  options: FreshEventDiscoveryOptions = {}
): Promise<FreshEventDiscoverySummary> {
  const summary: FreshEventDiscoverySummary = {
    proposed: 0,
    accepted: 0,
    rejected: 0,
    errors: [],
    events: [],
  }

  options.signal?.throwIfAborted()
  const raw = await proposeFreshEvents(now, options).catch((err) => {
    if (options.strict) throw err
    summary.errors.push(`grounded discovery: ${err instanceof Error ? err.message : 'unknown'}`)
    return []
  })
  summary.proposed = raw.length

  const seen = new Set<string>()
  for (const candidate of raw.slice(0, MAX_DISCOVERED_EVENTS)) {
    options.signal?.throwIfAborted()
    const event = await validateFreshEvent(candidate, now, options).catch((err) => {
      if (options.strict) throw err
      summary.errors.push(`validate ${candidate.name || 'event'}: ${err instanceof Error ? err.message : 'unknown'}`)
      return null
    })
    if (!event) {
      summary.rejected += 1
      continue
    }
    const key = `${event.name.toLowerCase()}|${event.starts_at}|${Math.round(event.lat * 1000)},${Math.round(event.lng * 1000)}`
    if (seen.has(key)) {
      summary.rejected += 1
      continue
    }
    seen.add(key)
    summary.events.push(event)
    summary.accepted += 1
  }

  return summary
}

async function proposeFreshEvents(now: Date, options: FreshEventDiscoveryOptions): Promise<RawFreshEvent[]> {
  const today = isoDate(now)
  const lookahead = isoDate(addDays(now, LOOKAHEAD_DAYS))

  const prompt = `Find Singapore date-night-worthy events that are newly launched, going viral, recently announced, or strongly trending right now.

Today is ${today}. Search current web results and propose events running between ${today} and ${lookahead}. Prefer short-lived pop-ups, art installations, immersive experiences, festivals, weekend markets, theatre, music, and food events. Include events like viral queues, fresh CNA/TimeOut/TSL/Straits Times coverage, official venue pages, or high-demand registration/ticket pages.

Return ONLY a raw JSON array of up to ${MAX_DISCOVERED_EVENTS} items. Each item:
{
  "name": "event name",
  "source_url": "official event page preferred; reputable editorial source acceptable",
  "venue_name": "specific Singapore venue",
  "venue_address": "specific Singapore address or venue name",
  "starts_at": "YYYY-MM-DD",
  "ends_at": "YYYY-MM-DD",
  "opens_at": "HHMM or null",
  "closes_at": "HHMM or null",
  "category_tags": ["1-3 tags from: ${CATEGORY_TAGS.join(', ')}"],
  "vibe_tags": ["0-2 tags from: ${VIBE_TAGS.join(', ')}"],
  "is_outdoor": true,
  "why_trending": "short factual reason based on the source/current signal",
  "trend_strength": 0.0
}

Rules:
- Singapore only.
- starts_at and ends_at must be explicit or clearly stated in the source.
- Exclude permanent attractions, generic restaurant openings, evergreen guides, and events ending before ${today}.
- source_url must be a public URL a user can verify.
- trend_strength is 0.5 to 1.0, where 1.0 means unusually strong current demand or viral attention.`

  const text = await chatComplete({
    model: EXTRACTION_MODEL,
    feature: options.feature ?? 'fresh-event-discovery',
    grounded: true,
    timeoutMs: 60_000,
    signal: options.signal,
    singleAttempt: options.singleAttempt,
    maxOutputTokens: options.maxOutputTokens,
    thinkingBudget: options.thinkingBudget,
    prompt,
  })
  const json = options.strict
    ? text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
    : text.match(/\[[\s\S]*\]/)?.[0]
  if (!json) {
    if (options.strict) throw new Error('Fresh-event discovery returned empty or invalid JSON')
    return []
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    if (options.strict) throw new Error('Fresh-event discovery returned malformed JSON')
    return []
  }
  if (!Array.isArray(parsed)) {
    if (options.strict) throw new Error('Fresh-event discovery did not return an event array')
    return []
  }

  // Cap before normalisation and source/OneMap calls even if the model ignores
  // the prompt's requested limit. A literal [] is a successful empty discovery.
  const candidates = parsed.slice(0, MAX_DISCOVERED_EVENTS).map(normalizeRawEvent)
  if (options.strict && candidates.some((event) => event === null)) {
    throw new Error('Fresh-event discovery returned invalid event data')
  }
  return candidates.filter((event): event is RawFreshEvent => event !== null)
}

function normalizeRawEvent(value: unknown): RawFreshEvent | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.name !== 'string' || v.name.trim().length < 3) return null
  if (typeof v.source_url !== 'string' || !/^https?:\/\//.test(v.source_url)) return null
  if (typeof v.venue_address !== 'string' || v.venue_address.trim().length < 3) return null
  if (typeof v.starts_at !== 'string' || !isIsoDate(v.starts_at)) return null
  if (typeof v.ends_at !== 'string' || !isIsoDate(v.ends_at)) return null

  const category_tags = Array.isArray(v.category_tags)
    ? v.category_tags
        .filter((t): t is string => typeof t === 'string' && (CATEGORY_TAGS as readonly string[]).includes(t))
        .slice(0, 3)
    : []
  const vibe_tags = Array.isArray(v.vibe_tags)
    ? v.vibe_tags
        .filter((t): t is string => typeof t === 'string' && (VIBE_TAGS as readonly string[]).includes(t))
        .slice(0, 2)
    : []

  return {
    name: v.name.trim().slice(0, 120),
    source_url: v.source_url.trim(),
    venue_name: typeof v.venue_name === 'string' && v.venue_name.trim() ? v.venue_name.trim() : v.venue_address.trim(),
    venue_address: v.venue_address.trim(),
    starts_at: v.starts_at,
    ends_at: v.ends_at,
    opens_at: typeof v.opens_at === 'string' && /^\d{4}$/.test(v.opens_at) ? v.opens_at : null,
    closes_at: typeof v.closes_at === 'string' && /^\d{4}$/.test(v.closes_at) ? v.closes_at : null,
    category_tags: category_tags.length > 0 ? category_tags : ['festival'],
    vibe_tags,
    is_outdoor: v.is_outdoor === true,
    why_trending: typeof v.why_trending === 'string' ? v.why_trending.trim().slice(0, 220) : '',
    trend_strength: clamp01(typeof v.trend_strength === 'number' ? v.trend_strength : 0.65),
  }
}

async function validateFreshEvent(
  raw: RawFreshEvent,
  now: Date,
  options: FreshEventDiscoveryOptions
): Promise<EditorialEvent | null> {
  const starts = parseSgDate(raw.starts_at, 'start')
  const ends = parseSgDate(raw.ends_at, 'end')
  if (!starts || !ends) return null
  if (ends.getTime() < startOfSgDay(now).getTime()) return null
  if (starts.getTime() > addDays(startOfSgDay(now), LOOKAHEAD_DAYS).getTime()) return null
  if (ends.getTime() < starts.getTime()) return null
  if ((ends.getTime() - starts.getTime()) / 86_400_000 > MAX_RUN_DAYS) return null

  const reachable = await sourceReachable(raw.source_url, options)
  if (!reachable) return null

  const location = await resolveLocation(raw.venue_name, raw.venue_address, options)
  if (!location) return null

  const tags = ['experience', ...raw.category_tags]
  return {
    source_id: `discovered-${slugify(raw.name)}-${raw.starts_at}`,
    source_url: raw.source_url,
    name: raw.name,
    address: location.address,
    lat: location.lat,
    lng: location.lng,
    starts_at: raw.starts_at,
    ends_at: raw.ends_at,
    cuisine_tags: dedupe(tags),
    vibe_tags: raw.vibe_tags,
    is_outdoor: raw.is_outdoor,
    budget_band: 2,
    hours: eventHours(raw.opens_at, raw.closes_at),
    summary: raw.why_trending || 'A fresh, time-bounded Singapore event discovered from current web signals.',
    trending_score: Math.max(0.5, raw.trend_strength),
  }
}

async function sourceReachable(url: string, options: FreshEventDiscoveryOptions): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Gabo/1.0)' },
      signal: AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(10_000)]),
    })
    await res.body?.cancel()
    if (options.strict && !res.ok && res.status !== 404 && res.status !== 410) {
      throw new Error(`Event source verification failed (${res.status})`)
    }
    if (options.strict) return res.ok
    return res.ok || (res.status < 500 && res.status !== 404)
  } catch (err) {
    if (options.strict) throw err
    return false
  }
}

async function resolveLocation(
  venueName: string,
  venueAddress: string,
  options: FreshEventDiscoveryOptions
): Promise<{ lat: number; lng: number; address: string } | null> {
  const queries = dedupe([
    venueAddress,
    `${venueName} Singapore`,
    `${venueName} ${venueAddress}`,
  ])

  for (const q of queries) {
    options.signal?.throwIfAborted()
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(10_000)])
      : undefined
    const hits = await searchPlaces(q, 1, signal).catch((err) => {
      if (options.strict) throw err
      return []
    })
    const hit = hits[0]
    if (!hit) continue
    if (hit.lat < 1.15 || hit.lat > 1.48 || hit.lng < 103.6 || hit.lng > 104.1) continue
    return { lat: hit.lat, lng: hit.lng, address: hit.address || venueAddress }
  }
  return null
}

function eventHours(open: string | null, close: string | null): HoursJson {
  const window = open && close ? { open, close } : { open: '1000', close: '2200' }
  return {
    mon: [window],
    tue: [window],
    wed: [window],
    thu: [window],
    fri: [window],
    sat: [window],
    sun: [window],
  }
}

function parseSgDate(raw: string, kind: 'start' | 'end'): Date | null {
  if (!isIsoDate(raw)) return null
  const suffix = kind === 'start' ? 'T00:00:00+08:00' : 'T23:59:59.999+08:00'
  const date = new Date(raw + suffix)
  return Number.isFinite(date.getTime()) ? date : null
}

function startOfSgDay(date: Date): Date {
  return parseSgDate(isoDate(date), 'start') ?? date
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000)
}

function isoDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const byType = new Map(parts.map((p) => [p.type, p.value]))
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`
}

function isIsoDate(raw: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw)
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))]
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}
