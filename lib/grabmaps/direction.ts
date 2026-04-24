import type { LatLng } from '../planner/types'
import { cacheGet, cacheKey, cacheSet } from './cache'

export type DirectionResult = {
  duration_sec: number
  distance_m: number
  geometry: unknown
  cached?: boolean
}

// Server-only. Calls GrabMaps Direction API (SKILL.md §3).
// Coordinates sent as `lng,lat` per GrabMaps convention.
//
// Caching: successful results live in lib/grabmaps/cache.ts for 1h so repeat
// plans on the same pair don't re-hit the API.
export async function fetchDirection(
  origin: LatLng,
  destination: LatLng,
  profile: 'driving' | 'walking' | 'cycling' | 'motorcycle' = 'driving'
): Promise<DirectionResult> {
  const apiKey = process.env.GRABMAPS_API_KEY
  if (!apiKey) throw new Error('GRABMAPS_API_KEY missing')

  const key = cacheKey(origin.lng, origin.lat, destination.lng, destination.lat, profile)
  const hit = cacheGet(key)
  if (hit) return { ...hit, cached: true }

  const params = new URLSearchParams()
  params.append('coordinates', `${origin.lng},${origin.lat}`)
  params.append('coordinates', `${destination.lng},${destination.lat}`)
  params.set('profile', profile)
  params.set('overview', 'full')
  params.set('geometries', 'geojson')

  const res = await fetch(
    `https://maps.grab.com/api/v1/maps/eta/v1/direction?${params}`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  )
  if (!res.ok) throw new Error(`GrabMaps direction ${res.status}`)

  const data = await res.json()
  const route = data.routes?.[0]
  if (!route) throw new Error('GrabMaps returned no route')

  const result: DirectionResult = {
    duration_sec: route.duration,
    distance_m: route.distance,
    geometry: route.geometry,
  }
  cacheSet(key, result)
  return result
}
