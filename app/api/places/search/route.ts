import { NextRequest } from 'next/server'

// Proxies GrabMaps POI keyword search. Returns a compact shape the
// PlaceSearchInput component can render directly.
// Endpoint: GET /maps/poi/v1/search (SKILL.md §3).

export async function GET(request: NextRequest) {
  const apiKey = process.env.GRABMAPS_API_KEY
  if (!apiKey) {
    return Response.json({ error: 'GRABMAPS_API_KEY missing' }, { status: 500 })
  }

  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim()
  if (!q || q.length < 2) {
    return Response.json({ results: [] })
  }

  const params = new URLSearchParams({
    keyword: q,
    country: 'SGP',
    location: '1.3521,103.8198', // SG centroid bias
    limit: '8',
  })

  const res = await fetch(`https://maps.grab.com/api/v1/maps/poi/v1/search?${params}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    // Cache for 30s at the edge; same query repeated within that window is free.
    next: { revalidate: 30 },
  })

  if (!res.ok) {
    return Response.json(
      { error: 'GrabMaps upstream error', status: res.status, results: [] },
      { status: 502 }
    )
  }

  const data = (await res.json()) as GrabMapsSearchResponse
  const results = (data.places ?? [])
    .map((p) => {
      const lat = p.location?.latitude
      const lng = p.location?.longitude
      const name = p.short_name ?? p.name
      if (!p.poi_id || !name || typeof lat !== 'number' || typeof lng !== 'number') return null
      return {
        id: p.poi_id,
        name,
        address: p.formatted_address ?? p.street ?? '',
        lat,
        lng,
      }
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)

  return Response.json({ results })
}

type GrabMapsSearchResponse = {
  places?: {
    poi_id?: string
    short_name?: string
    name?: string
    formatted_address?: string
    street?: string
    location?: {
      latitude?: number
      longitude?: number
    }
  }[]
}
