import type { LatLng, Profile, VibeTag } from './types'

const SG_BOUNDS = {
  minLat: 1.1,
  maxLat: 1.5,
  minLng: 103.5,
  maxLng: 104.1,
}

const TRANSIT_PREFS = new Set(['mrt', 'grab', 'either'])
const VIBE_TAGS = new Set(['cozy', 'adventurous', 'celebratory', 'low_key'])

export type PlanRequest = {
  start_a: LatLng | null
  start_b: LatLng | null
  scheduled_for: string
  override_tags: string[]
  profile: Profile
}

export function parsePlanRequest(value: unknown): PlanRequest | null {
  if (!isRecord(value)) return null

  // Locations are optional. If a key is provided but doesn't validate as a SG
  // coord, reject — we'd rather error than silently downgrade to islandwide.
  const startA = parseOptionalLatLng(value.start_a)
  const startB = parseOptionalLatLng(value.start_b)
  if (startA === undefined || startB === undefined) return null

  const scheduledFor = parseString(value.scheduled_for, 80)
  const profile = parseProfile(value.profile)
  if (!scheduledFor || !profile) return null

  return {
    start_a: startA,
    start_b: startB,
    scheduled_for: scheduledFor,
    override_tags: parseStringArray(value.override_tags, 12, 60),
    profile,
  }
}

// Returns null when the field is missing, the parsed point when valid, or
// undefined when it was provided but invalid (so callers can reject).
function parseOptionalLatLng(value: unknown): LatLng | null | undefined {
  if (value == null) return null
  return parseLatLng(value) ?? undefined
}

export function parseLatLng(value: unknown): LatLng | null {
  if (!isRecord(value)) return null
  const lat = value.lat
  const lng = value.lng
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < SG_BOUNDS.minLat || lat > SG_BOUNDS.maxLat) return null
  if (lng < SG_BOUNDS.minLng || lng > SG_BOUNDS.maxLng) return null
  return { lat, lng }
}

function parseProfile(value: unknown): Profile | null {
  if (!isRecord(value)) return null

  const transitPref = typeof value.transit_pref === 'string' ? value.transit_pref : 'either'
  if (!TRANSIT_PREFS.has(transitPref)) return null

  return {
    planner_name: parseString(value.planner_name, 40) ?? 'You',
    partner_name: parseString(value.partner_name, 40) ?? 'Partner',
    cuisines_loved: parseStringArray(value.cuisines_loved, 24, 40),
    cuisines_avoided: parseStringArray(value.cuisines_avoided, 24, 40),
    dietary_hardstops: parseStringArray(value.dietary_hardstops, 24, 40),
    vibe_defaults: parseStringArray(value.vibe_defaults, 8, 40).filter((v): v is VibeTag =>
      VIBE_TAGS.has(v)
    ),
    budget_bands: parseBudgetBands(value.budget_bands),
    transit_pref: transitPref as Profile['transit_pref'],
  }
}

function parseBudgetBands(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const bands = value.filter((v): v is number => Number.isInteger(v) && v >= 1 && v <= 4)
  return [...new Set(bands)].slice(0, 4)
}

function parseString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

function parseStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().slice(0, maxLength))
        .filter(Boolean)
    ),
  ].slice(0, maxItems)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
