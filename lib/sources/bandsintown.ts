// Bandsintown API client — free SG concerts/gigs feed for the events
// catalog. No signup beyond an `app_id` (any string identifying us).
//
// Docs: https://app.swaggerhub.com/apis-docs/Bandsintown/PublicAPI/3.0.1
//
// We query the city endpoint (Singapore) and filter to events between today
// and 90 days out. Each event becomes one row in our venues table with
// source='bandsintown', cuisine_tags=['experience','music'], and a
// closing_soon badge if the event ends within 30 days.

import type { HoursJson, Venue } from '@/lib/planner/types'

const BASE = 'https://rest.bandsintown.com'
const SG_CITY = 'Singapore,Singapore'

export class BandsintownAuthError extends Error {}

type RawEvent = {
  id?: string
  url?: string
  datetime?: string // ISO local
  title?: string
  description?: string
  artist?: { name?: string }
  venue?: {
    name?: string
    city?: string
    country?: string
    latitude?: string | number
    longitude?: string | number
    location?: string
  }
}

export type BandsintownEvent = {
  source_id: string
  url: string
  datetime: string
  artist_name: string
  venue_name: string
  address: string
  lat: number
  lng: number
}

function appId(): string {
  const id = process.env.BANDSINTOWN_APP_ID
  if (!id) throw new BandsintownAuthError('BANDSINTOWN_APP_ID missing')
  return id
}

// City-search endpoint pulls every artist with an upcoming SG event. We then
// hydrate each event individually (cheap; the response carries everything).
// The Bandsintown "city" endpoint returns up to 100 events per call.
export async function fetchSingaporeConcerts(): Promise<BandsintownEvent[]> {
  const url = new URL(`${BASE}/concerts/v3.1/concerts`)
  url.searchParams.set('city', SG_CITY)
  url.searchParams.set('app_id', appId())

  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } })
  if (res.status === 401 || res.status === 403) {
    throw new BandsintownAuthError(`Bandsintown ${res.status} (bad app_id)`)
  }
  if (!res.ok) throw new Error(`Bandsintown ${res.status}: ${await res.text().catch(() => '')}`)

  const data = (await res.json()) as RawEvent[]
  return data.map(toEvent).filter((e): e is BandsintownEvent => e !== null)
}

function toEvent(raw: RawEvent): BandsintownEvent | null {
  const id = raw.id
  const url = raw.url
  const datetime = raw.datetime
  const artist = raw.artist?.name
  const venue = raw.venue
  const lat = parseCoord(venue?.latitude)
  const lng = parseCoord(venue?.longitude)
  if (!id || !url || !datetime || !artist || !venue?.name || lat === null || lng === null) return null

  return {
    source_id: id,
    url,
    datetime,
    artist_name: artist,
    venue_name: venue.name,
    address: venue.location ?? `${venue.city ?? ''}${venue.country ? `, ${venue.country}` : ''}`,
    lat,
    lng,
  }
}

function parseCoord(v: string | number | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

const HORIZON_DAYS = 90
const CLOSING_SOON_DAYS = 30

export function bandsintownEventToVenue(e: BandsintownEvent): Omit<Venue, 'id'> & {
  source: 'bandsintown'
  source_id: string
  source_url: string
  last_synced_at: string
} {
  const eventDate = new Date(e.datetime)
  const daysUntil = Math.round((eventDate.getTime() - Date.now()) / 86_400_000)

  const badge = daysUntil <= CLOSING_SOON_DAYS ? 'closing_soon' : 'none'
  const badgeMeta = badge === 'closing_soon' ? { ends_at: e.datetime, reason: 'one-night concert' } : null

  // Hours: just the event datetime as a single 2-hour window on the matching day.
  const hours = singleEventHours(eventDate)

  return {
    name: `${e.artist_name} — Live in Singapore`,
    lat: e.lat,
    lng: e.lng,
    address: `${e.venue_name} · ${e.address}`,
    cuisine_tags: ['experience', 'music', 'nightlife'],
    vibe_tags: ['adventurous'],
    dietary_flags: [],
    budget_band: 3,
    is_outdoor: false,
    photo_url: null,
    chope_url: null,
    hours_json: hours,
    ph_hours_json: null,
    badge,
    badge_meta: badgeMeta,
    trending_score: 0,
    active: daysUntil >= 0 && daysUntil <= HORIZON_DAYS,
    source: 'bandsintown',
    source_id: e.source_id,
    source_url: e.url,
    last_synced_at: new Date().toISOString(),
  }
}

function singleEventHours(eventDate: Date): HoursJson {
  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
  const key = dayKeys[eventDate.getDay()]
  const start = `${String(eventDate.getHours()).padStart(2, '0')}${String(eventDate.getMinutes()).padStart(2, '0')}`
  const end = `${String(Math.min(eventDate.getHours() + 2, 23)).padStart(2, '0')}${String(eventDate.getMinutes()).padStart(2, '0')}`
  return { [key]: [{ open: start, close: end }] }
}
