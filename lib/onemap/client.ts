// Server-only OneMap client. Replaces the dead GrabMaps integration.
// Endpoints used:
//   POST /api/auth/post/getToken                    — exchange email/password
//                                                     for a 3-day JWT
//   GET  /api/common/elastic/search                 — POI / address search
//   GET  /api/public/routingsvc/route?routeType=    — drive | walk | cycle | pt
//
// Auth: tokens cached in-memory and refreshed on 401 / near-expiry.
// Caching: route results live in lib/onemap/cache.ts (1h driving / 30m
// transit) so repeat plans on the same pair don't re-hit the API.

import { cacheGet, cacheSet, routeKey, tokenStore } from './cache'

const BASE = 'https://www.onemap.gov.sg'
const TRANSIT_TTL_MS = 30 * 60 * 1000

export type SearchResult = {
  id: string
  name: string
  address: string
  lat: number
  lng: number
}

export type DriveRouteResult = {
  duration_sec: number
  distance_m: number
  geometry: GeoJSON.LineString
  cached?: boolean
}

export type TransitLeg = {
  mode: 'WALK' | 'BUS' | 'SUBWAY' | 'RAIL' | string
  line?: string | null
  duration_sec: number
}

export type TransitRouteResult = {
  duration_sec: number
  walk_distance_m: number
  legs: TransitLeg[]
  cached?: boolean
}

export class OneMapAuthError extends Error {}
export class OneMapApiError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

async function getToken(forceRefresh = false): Promise<string> {
  const cached = tokenStore.get()
  if (!forceRefresh && cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token
  }

  const email = process.env.ONEMAP_EMAIL
  const password = process.env.ONEMAP_PASSWORD
  if (!email || !password) {
    throw new OneMapAuthError(
      'ONEMAP_EMAIL and ONEMAP_PASSWORD must be set. Sign up free at https://www.onemap.gov.sg/apidocs/register.'
    )
  }

  const res = await fetch(`${BASE}/api/auth/post/getToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new OneMapAuthError(`OneMap auth failed (${res.status}): ${text}`)
  }
  const data = (await res.json()) as { access_token?: string; expiry_timestamp?: string | number }
  if (!data.access_token) throw new OneMapAuthError('OneMap auth: no access_token in response')

  // expiry_timestamp is Unix seconds; default to 24h if absent.
  const expiresAt = data.expiry_timestamp
    ? Number(data.expiry_timestamp) * 1000
    : Date.now() + 24 * 60 * 60 * 1000
  tokenStore.set(data.access_token, expiresAt)
  return data.access_token
}

// ---------- Search ----------

type SearchHit = {
  SEARCHVAL?: string
  BLK_NO?: string
  ROAD_NAME?: string
  BUILDING?: string
  ADDRESS?: string
  POSTAL?: string
  LATITUDE?: string
  LONGITUDE?: string
}

export async function searchPlaces(query: string, limit = 8): Promise<SearchResult[]> {
  // Search accepts unauth calls but emits a deprecation warning. Pass a token
  // if available; ignore auth errors so search still works pre-config.
  let token: string | null = null
  try {
    token = await getToken()
  } catch {
    token = null
  }

  const url = new URL(`${BASE}/api/common/elastic/search`)
  url.searchParams.set('searchVal', query)
  url.searchParams.set('returnGeom', 'Y')
  url.searchParams.set('getAddrDetails', 'Y')
  url.searchParams.set('pageNum', '1')

  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(url.toString(), {
    headers,
    next: { revalidate: 60 },
  })
  if (!res.ok) throw new OneMapApiError(`OneMap search ${res.status}`, res.status)

  const data = (await res.json()) as { results?: SearchHit[] }
  return (data.results ?? [])
    .slice(0, limit)
    .map(toSearchResult)
    .filter((r): r is SearchResult => r !== null)
}

function toSearchResult(h: SearchHit): SearchResult | null {
  const lat = h.LATITUDE ? parseFloat(h.LATITUDE) : NaN
  const lng = h.LONGITUDE ? parseFloat(h.LONGITUDE) : NaN
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const building = h.BUILDING && h.BUILDING !== 'NIL' ? h.BUILDING : null
  const name = building ?? h.SEARCHVAL ?? h.ADDRESS ?? `${lat},${lng}`
  const address = h.ADDRESS ?? ''
  return {
    id: `${h.POSTAL ?? `${lat.toFixed(5)},${lng.toFixed(5)}`}-${name}`,
    name,
    address,
    lat,
    lng,
  }
}

// ---------- Drive routing ----------

type DriveResponse = {
  status_message?: string
  route_summary?: { total_time?: number; total_distance?: number }
  route_geometry?: string // encoded polyline (precision 5)
}

export async function fetchDriveRoute(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number }
): Promise<DriveRouteResult> {
  const key = routeKey(origin.lng, origin.lat, destination.lng, destination.lat, 'drive')
  const hit = cacheGet<DriveRouteResult>(key)
  if (hit) return { ...hit, cached: true }

  const token = await getToken()
  const url = new URL(`${BASE}/api/public/routingsvc/route`)
  url.searchParams.set('start', `${origin.lat},${origin.lng}`)
  url.searchParams.set('end', `${destination.lat},${destination.lng}`)
  url.searchParams.set('routeType', 'drive')

  let res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  })
  // Token may have rotated; retry once with a fresh token.
  if (res.status === 401) {
    const fresh = await getToken(true)
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${fresh}` },
    })
  }
  if (!res.ok) throw new OneMapApiError(`OneMap drive route ${res.status}`, res.status)

  const data = (await res.json()) as DriveResponse
  const time = data.route_summary?.total_time
  const distance = data.route_summary?.total_distance
  if (typeof time !== 'number' || typeof distance !== 'number') {
    throw new OneMapApiError('OneMap drive route missing summary', 502)
  }

  const result: DriveRouteResult = {
    duration_sec: time,
    distance_m: distance,
    geometry: {
      type: 'LineString',
      coordinates: data.route_geometry ? decodePolyline(data.route_geometry) : [],
    },
  }
  cacheSet(key, result)
  return result
}

// ---------- Public-transit routing ----------

type TransitResponse = {
  plan?: {
    itineraries?: {
      duration?: number // seconds
      walkDistance?: number // metres
      legs?: {
        mode?: string
        duration?: number // seconds (some responses use ms; we normalise)
        route?: string
        routeShortName?: string
      }[]
    }[]
  }
}

export async function fetchTransitRoute(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  scheduledFor: Date
): Promise<TransitRouteResult> {
  const dateBucket = formatDateBucket(scheduledFor)
  const key = routeKey(origin.lng, origin.lat, destination.lng, destination.lat, 'pt', dateBucket)
  const hit = cacheGet<TransitRouteResult>(key)
  if (hit) return { ...hit, cached: true }

  const token = await getToken()
  const url = new URL(`${BASE}/api/public/routingsvc/route`)
  url.searchParams.set('start', `${origin.lat},${origin.lng}`)
  url.searchParams.set('end', `${destination.lat},${destination.lng}`)
  url.searchParams.set('routeType', 'pt')
  url.searchParams.set('date', formatDate(scheduledFor))
  url.searchParams.set('time', formatTime(scheduledFor))
  url.searchParams.set('mode', 'TRANSIT')
  url.searchParams.set('maxWalkDistance', '1000')
  url.searchParams.set('numItineraries', '1')

  let res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) {
    const fresh = await getToken(true)
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${fresh}` },
    })
  }
  if (!res.ok) throw new OneMapApiError(`OneMap pt route ${res.status}`, res.status)

  const data = (await res.json()) as TransitResponse
  const itin = data.plan?.itineraries?.[0]
  if (!itin || typeof itin.duration !== 'number') {
    throw new OneMapApiError('OneMap pt route returned no itinerary', 502)
  }

  const legs: TransitLeg[] = (itin.legs ?? []).map((l) => ({
    mode: (l.mode ?? 'WALK') as TransitLeg['mode'],
    line: l.routeShortName ?? l.route ?? null,
    duration_sec: typeof l.duration === 'number' ? l.duration : 0,
  }))

  const result: TransitRouteResult = {
    duration_sec: itin.duration,
    walk_distance_m: itin.walkDistance ?? 0,
    legs,
  }
  cacheSet(key, result, TRANSIT_TTL_MS)
  return result
}

function formatDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const yy = d.getFullYear()
  return `${mm}-${dd}-${yy}`
}

function formatTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mi}:00`
}

// Bucket transit cache by hour-of-week — schedules vary by time of day but
// not minute-by-minute. Same Friday at 19:30 across two weeks reuses the
// itinerary; 19:30 vs 21:00 don't.
function formatDateBucket(d: Date): string {
  return `${d.getDay()}-${d.getHours()}`
}

// ---------- Polyline decoder (Google polyline algorithm, precision 5) ----------
// OneMap returns drive geometries in this format. Output: [lng, lat] pairs
// for direct GeoJSON consumption.
function decodePolyline(str: string, precision = 5): [number, number][] {
  const factor = Math.pow(10, precision)
  let index = 0
  let lat = 0
  let lng = 0
  const coordinates: [number, number][] = []

  while (index < str.length) {
    let shift = 0
    let result = 0
    let byte: number
    do {
      byte = str.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    const dlat = result & 1 ? ~(result >> 1) : result >> 1
    lat += dlat

    shift = 0
    result = 0
    do {
      byte = str.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    const dlng = result & 1 ? ~(result >> 1) : result >> 1
    lng += dlng

    coordinates.push([lng / factor, lat / factor])
  }
  return coordinates
}
