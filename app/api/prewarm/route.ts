import { fetchDriveRoute } from '@/lib/onemap/client'
import { cacheStats } from '@/lib/onemap/cache'
import { mapWithConcurrency } from '@/lib/async/pool'
import { catalog } from '@/lib/venues/catalog'
import type { LatLng } from '@/lib/planner/types'

// Warm the OneMap drive-route cache with every (common start × venue) pair
// so the first plan from a popular start doesn't pay routing latency.
//   curl -X POST http://localhost:3000/api/prewarm
// Optionally protect with PREWARM_TOKEN.

const POPULAR_STARTS: LatLng[] = [
  { lat: 1.3181, lng: 103.8924 }, // Paya Lebar
  { lat: 1.3329, lng: 103.7436 }, // Jurong East
  { lat: 1.2819, lng: 103.8506 }, // Raffles Place
  { lat: 1.3048, lng: 103.8318 }, // Orchard
  { lat: 1.2834, lng: 103.8603 }, // Marina Bay Sands
  { lat: 1.3521, lng: 103.8198 }, // SG centroid
]

const PREWARM_CONCURRENCY = 5

export async function POST(request: Request) {
  const expectedToken = process.env.PREWARM_TOKEN
  if (expectedToken) {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (token !== expectedToken) {
      return Response.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  const pairs: { origin: LatLng; destination: LatLng }[] = []
  for (const start of POPULAR_STARTS) {
    for (const v of catalog) {
      pairs.push({ origin: start, destination: { lat: v.lat, lng: v.lng } })
    }
  }

  const started = Date.now()
  const results = await mapWithConcurrency(pairs, PREWARM_CONCURRENCY, async (p) => {
    try {
      await fetchDriveRoute(p.origin, p.destination)
      return true
    } catch {
      return false
    }
  })

  const ok = results.filter((r) => r === true).length
  const failed = results.filter((r) => r === false).length

  return Response.json({
    total: pairs.length,
    ok,
    failed,
    concurrency: PREWARM_CONCURRENCY,
    cache_size: cacheStats().size,
    elapsed_ms: Date.now() - started,
  })
}
