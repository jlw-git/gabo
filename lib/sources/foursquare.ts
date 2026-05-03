// Foursquare Places API client — fallback for when Google Places quota
// is exhausted. Free tier: 1,000 calls/day, but the freePro tier can run
// out of credits separately and require a top-up at
// https://foursquare.com/developers/orgs.
//
// The legacy /v3 endpoint at api.foursquare.com was deprecated in 2024;
// we now use the places-api.foursquare.com host with Bearer auth and an
// X-Places-Api-Version header. Field names changed too — fsq_place_id
// instead of fsq_id, latitude/longitude on the result (not nested
// under geocodes.main).
//
// Docs: https://docs.foursquare.com/fsq-developers-places/reference/places-api-overview

import type { DayKey, HoursJson, HoursWindow, Venue } from '@/lib/planner/types'

const BASE = 'https://places-api.foursquare.com'
const API_VERSION = '2025-06-17'
const SG_NEAR = 'Singapore,SG'

export class FoursquareAuthError extends Error {}
export class FoursquareQuotaError extends Error {}

type RawPlace = {
  fsq_place_id?: string
  name?: string
  location?: { formatted_address?: string; address?: string; locality?: string }
  latitude?: number
  longitude?: number
  categories?: { fsq_category_id?: string; name?: string; short_name?: string }[]
  price?: number
  rating?: number
  hours?: { display?: string; regular?: RawHours[] }
  photos?: { prefix?: string; suffix?: string }[]
  link?: string
  website?: string
}

type RawHours = {
  day?: number // 1=Mon..7=Sun (Foursquare convention)
  open?: string // "HHMM"
  close?: string
}

export type FoursquarePlace = {
  source_id: string
  name: string
  address: string
  lat: number
  lng: number
  categories: string[]
  rating?: number
  price_level?: number
  hours: HoursJson | null
  photo_url?: string
  source_url: string
}

function apiKey(): string {
  const key = process.env.FOURSQUARE_API_KEY
  if (!key) throw new FoursquareAuthError('FOURSQUARE_API_KEY missing')
  return key
}

export async function searchPlaces(query: string, limit = 20): Promise<FoursquarePlace[]> {
  const url = new URL(`${BASE}/places/search`)
  url.searchParams.set('query', query)
  url.searchParams.set('near', SG_NEAR)
  url.searchParams.set('limit', String(Math.min(limit, 50)))
  url.searchParams.set(
    'fields',
    'fsq_place_id,name,location,latitude,longitude,categories,price,rating,hours,photos,link,website'
  )

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      Accept: 'application/json',
      'X-Places-Api-Version': API_VERSION,
    },
  })

  if (res.status === 401) throw new FoursquareAuthError('Foursquare: 401 (bad key)')
  if (res.status === 402)
    throw new FoursquareQuotaError(
      'Foursquare: 402 (no API credits — top up at foursquare.com/developers/orgs)'
    )
  if (res.status === 429) throw new FoursquareQuotaError('Foursquare: 429 quota exceeded')
  if (!res.ok) throw new Error(`Foursquare search ${res.status}: ${await res.text().catch(() => '')}`)

  const data = (await res.json()) as { results?: RawPlace[] }
  return (data.results ?? [])
    .map(toFoursquarePlace)
    .filter((p): p is FoursquarePlace => p !== null)
}

function toFoursquarePlace(raw: RawPlace): FoursquarePlace | null {
  const id = raw.fsq_place_id
  const name = raw.name
  const lat = raw.latitude
  const lng = raw.longitude
  if (!id || !name || typeof lat !== 'number' || typeof lng !== 'number') return null

  return {
    source_id: id,
    name,
    address: raw.location?.formatted_address ?? raw.location?.address ?? raw.location?.locality ?? '',
    lat,
    lng,
    categories: (raw.categories ?? []).map((c) => c.short_name ?? c.name ?? '').filter(Boolean),
    rating: raw.rating,
    price_level: raw.price, // Foursquare returns 1..4 directly
    hours: raw.hours?.regular ? toHoursJson(raw.hours.regular) : null,
    photo_url: photoUrl(raw.photos?.[0]),
    source_url: raw.website ?? `https://foursquare.com/v/${id}`,
  }
}

const FSQ_DAY_INDEX: Record<number, DayKey> = {
  1: 'mon',
  2: 'tue',
  3: 'wed',
  4: 'thu',
  5: 'fri',
  6: 'sat',
  7: 'sun',
}

function toHoursJson(periods: RawHours[]): HoursJson {
  const out: HoursJson = {}
  for (const p of periods) {
    if (p.day === undefined || !FSQ_DAY_INDEX[p.day]) continue
    if (!p.open || !p.close) continue
    const key = FSQ_DAY_INDEX[p.day]
    const w: HoursWindow = { open: p.open, close: p.close }
    out[key] = [...(out[key] ?? []), w]
  }
  return out
}

function photoUrl(p: { prefix?: string; suffix?: string } | undefined): string | undefined {
  if (!p?.prefix || !p?.suffix) return undefined
  return `${p.prefix}800x600${p.suffix}`
}

// Cuisine inference from Foursquare's category names. Coarse but workable.
const CATEGORY_TO_CUISINE: Record<string, string> = {
  Italian: 'italian',
  Japanese: 'japanese',
  Chinese: 'chinese',
  Korean: 'korean',
  Thai: 'thai',
  Indian: 'indian',
  French: 'french',
  Vietnamese: 'vietnamese',
  Mexican: 'mexican',
  Spanish: 'spanish',
  Mediterranean: 'mediterranean',
  'Middle Eastern': 'middle_eastern',
  American: 'american',
  'Cocktail Bar': 'cocktail',
  Bar: 'cocktail',
  Cafe: 'cafe',
  Bakery: 'bakery',
}

export function foursquarePlaceToVenue(p: FoursquarePlace): Omit<Venue, 'id' | 'created_at'> & {
  source: 'foursquare'
  source_id: string
  source_url: string
  last_synced_at: string
} {
  const cuisines = new Set<string>()
  for (const c of p.categories) {
    for (const key of Object.keys(CATEGORY_TO_CUISINE)) {
      if (c.includes(key)) cuisines.add(CATEGORY_TO_CUISINE[key])
    }
  }

  return {
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    address: p.address,
    cuisine_tags: [...cuisines],
    vibe_tags: [],
    dietary_flags: [],
    budget_band: p.price_level ?? 2,
    is_outdoor: false,
    photo_url: p.photo_url ?? null,
    chope_url: null,
    hours_json: p.hours,
    ph_hours_json: null,
    badge: 'none',
    badge_meta: null,
    trending_score: 0,
    active: true,
    source: 'foursquare',
    source_id: p.source_id,
    source_url: p.source_url,
    last_synced_at: new Date().toISOString(),
  }
}
