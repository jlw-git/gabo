// Google Places API (New) client — Text Search + Place Details.
// Docs: https://developers.google.com/maps/documentation/places/web-service/op-overview
//
// Auth: X-Goog-Api-Key header. Free tier $200/mo credit covers ~10k venue
// fetches comfortably for our refresh cadence.
//
// We call this from cron only (not request-path) so latency isn't a concern,
// but we do constrain field masks tightly to keep cost down — Google bills
// by SKU based on the fields you request.

import type { DayKey, HoursJson, HoursWindow, Venue } from '@/lib/planner/types'

const BASE = 'https://places.googleapis.com/v1'

// SG centroid + a generous radius to bias text search to local results.
const SG_LOCATION = { lat: 1.3521, lng: 103.8198 }
const SG_RADIUS_M = 25_000

const TEXT_SEARCH_FIELDS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.types',
  'places.priceLevel',
  'places.rating',
  'places.userRatingCount',
  'places.regularOpeningHours',
  'places.photos',
  'places.websiteUri',
  'places.googleMapsUri',
].join(',')

export class GooglePlacesQuotaError extends Error {}
export class GooglePlacesAuthError extends Error {}

type RawPlace = {
  id?: string
  displayName?: { text?: string }
  formattedAddress?: string
  location?: { latitude?: number; longitude?: number }
  types?: string[]
  priceLevel?: string
  rating?: number
  userRatingCount?: number
  regularOpeningHours?: { periods?: RawPeriod[] }
  photos?: { name?: string }[]
  websiteUri?: string
  googleMapsUri?: string
}

type RawPeriod = {
  open?: { day?: number; hour?: number; minute?: number }
  close?: { day?: number; hour?: number; minute?: number }
}

export type GooglePlace = {
  source_id: string
  name: string
  address: string
  lat: number
  lng: number
  types: string[]
  rating?: number
  rating_count?: number
  price_level?: number
  hours: HoursJson | null
  photo_url?: string
  source_url: string
}

function apiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) throw new GooglePlacesAuthError('GOOGLE_PLACES_API_KEY missing')
  return key
}

// Free-text query against SG. e.g. "japanese omakase singapore",
// "wine bar tanjong pagar", "italian restaurant marina bay".
export async function textSearch(query: string, maxResults = 20): Promise<GooglePlace[]> {
  const res = await fetch(`${BASE}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey(),
      'X-Goog-FieldMask': TEXT_SEARCH_FIELDS,
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: maxResults,
      locationBias: {
        circle: {
          center: { latitude: SG_LOCATION.lat, longitude: SG_LOCATION.lng },
          radius: SG_RADIUS_M,
        },
      },
      includedType: 'restaurant',
    }),
  })

  if (res.status === 403) throw new GooglePlacesAuthError('Google Places: 403 (key disabled or billing not enabled)')
  if (res.status === 429) throw new GooglePlacesQuotaError('Google Places: 429 quota exceeded')
  if (!res.ok) throw new Error(`Google Places search ${res.status}: ${await res.text().catch(() => '')}`)

  const data = (await res.json()) as { places?: RawPlace[] }
  return (data.places ?? [])
    .map(toGooglePlace)
    .filter((p): p is GooglePlace => p !== null)
}

function toGooglePlace(raw: RawPlace): GooglePlace | null {
  const id = raw.id
  const name = raw.displayName?.text
  const lat = raw.location?.latitude
  const lng = raw.location?.longitude
  if (!id || !name || typeof lat !== 'number' || typeof lng !== 'number') return null

  return {
    source_id: id,
    name,
    address: raw.formattedAddress ?? '',
    lat,
    lng,
    types: raw.types ?? [],
    rating: raw.rating,
    rating_count: raw.userRatingCount,
    price_level: parsePriceLevel(raw.priceLevel),
    hours: raw.regularOpeningHours ? toHoursJson(raw.regularOpeningHours.periods ?? []) : null,
    photo_url: photoUrl(raw.photos?.[0]?.name),
    source_url: raw.googleMapsUri ?? raw.websiteUri ?? `https://www.google.com/maps/place/?q=place_id:${id}`,
  }
}

// Google's PRICE_LEVEL_INEXPENSIVE → 1, _MODERATE → 2, _EXPENSIVE → 3, _VERY_EXPENSIVE → 4.
function parsePriceLevel(value: string | undefined): number | undefined {
  switch (value) {
    case 'PRICE_LEVEL_FREE':
    case 'PRICE_LEVEL_INEXPENSIVE':
      return 1
    case 'PRICE_LEVEL_MODERATE':
      return 2
    case 'PRICE_LEVEL_EXPENSIVE':
      return 3
    case 'PRICE_LEVEL_VERY_EXPENSIVE':
      return 4
    default:
      return undefined
  }
}

const DAY_INDEX: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function toHoursJson(periods: RawPeriod[]): HoursJson {
  const out: HoursJson = {}
  for (const p of periods) {
    const day = p.open?.day
    if (day === undefined || day < 0 || day > 6) continue
    const key = DAY_INDEX[day]
    const open = pad4(p.open?.hour, p.open?.minute)
    const close = pad4(p.close?.hour, p.close?.minute)
    if (!open || !close) continue
    const window: HoursWindow = { open, close }
    out[key] = [...(out[key] ?? []), window]
  }
  return out
}

function pad4(h: number | undefined, m: number | undefined): string | null {
  if (h === undefined || m === undefined) return null
  return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`
}

// Constructs a public photo URL via Place Photos. The `name` returned in the
// search response is in the form `places/<id>/photos/<photo_id>` and must be
// hit through the Photos endpoint with our key. We use `maxWidthPx=800` to
// keep payload small.
function photoUrl(name: string | undefined): string | undefined {
  if (!name) return undefined
  const url = new URL(`${BASE}/${name}/media`)
  url.searchParams.set('maxWidthPx', '800')
  url.searchParams.set('key', apiKey())
  return url.toString()
}

// ---------- Mapping → our Venue shape ----------

// Heuristic for our cuisine_tags from Google's `types`. Google returns
// generic "restaurant", "food", etc plus sometimes a cuisine. We pull the
// most informative and let curation refine later.
const TYPE_TO_CUISINE: Record<string, string> = {
  italian_restaurant: 'italian',
  japanese_restaurant: 'japanese',
  chinese_restaurant: 'chinese',
  korean_restaurant: 'korean',
  thai_restaurant: 'thai',
  indian_restaurant: 'indian',
  french_restaurant: 'french',
  vietnamese_restaurant: 'vietnamese',
  mexican_restaurant: 'mexican',
  spanish_restaurant: 'spanish',
  mediterranean_restaurant: 'mediterranean',
  middle_eastern_restaurant: 'middle_eastern',
  american_restaurant: 'american',
  bar: 'cocktail',
  cafe: 'cafe',
  bakery: 'bakery',
}

export function googlePlaceToVenue(p: GooglePlace): Omit<Venue, 'id' | 'created_at'> & {
  source: 'google_places'
  source_id: string
  source_url: string
  last_synced_at: string
} {
  const cuisines = new Set<string>()
  for (const t of p.types) {
    const tag = TYPE_TO_CUISINE[t]
    if (tag) cuisines.add(tag)
  }

  return {
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    address: p.address,
    cuisine_tags: [...cuisines],
    vibe_tags: [], // Not derivable from Google; left for editorial enrichment
    dietary_flags: [],
    budget_band: p.price_level ?? 2,
    is_outdoor: false,
    photo_url: p.photo_url ?? null,
    chope_url: null, // Booking link comes from booking-url fallback (Google search)
    hours_json: p.hours,
    ph_hours_json: null,
    badge: 'none',
    badge_meta: null,
    trending_score: 0,
    active: true,
    source: 'google_places',
    source_id: p.source_id,
    source_url: p.source_url,
    last_synced_at: new Date().toISOString(),
  }
}
