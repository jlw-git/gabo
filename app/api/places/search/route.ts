import { NextRequest } from 'next/server'
import { OneMapApiError, OneMapAuthError, searchPlaces } from '@/lib/onemap/client'

// POI / address search backed by OneMap (replaces the dead GrabMaps proxy).
// Returns a compact shape the PlaceSearchInput component can render directly.

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim()
  if (!q || q.length < 2) {
    return Response.json({ results: [] })
  }

  try {
    const results = await searchPlaces(q, 8)
    return Response.json({ results })
  } catch (err) {
    if (err instanceof OneMapAuthError) {
      return Response.json({ error: err.message, results: [] }, { status: 500 })
    }
    if (err instanceof OneMapApiError) {
      return Response.json(
        { error: 'OneMap upstream error', status: err.status, results: [] },
        { status: 502 }
      )
    }
    throw err
  }
}
