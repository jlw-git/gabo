import { NextRequest } from 'next/server'

// Backend proxy for any maps.grab.com resource (style.json, tiles, sprites,
// glyphs, etc). Keeps GRABMAPS_API_KEY server-side per hackathon rules; clients
// call /api/grabmaps/proxy?u=<encoded-upstream-url>.

const UPSTREAM_HOST = 'maps.grab.com'

export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get('u')
  const url = parseUpstreamUrl(target)
  if (!url) {
    return new Response('invalid upstream', { status: 400 })
  }
  const apiKey = process.env.GRABMAPS_API_KEY
  if (!apiKey) return new Response('GRABMAPS_API_KEY missing', { status: 500 })

  const upstream = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 3600 },
  })
  if (!upstream.ok) {
    return new Response(`upstream ${upstream.status}`, { status: upstream.status })
  }
  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'
  const buffer = await upstream.arrayBuffer()
  return new Response(buffer, {
    status: 200,
    headers: {
      'content-type': contentType,
      // Tiles and sprites change rarely; cache aggressively to cut round-trips.
      'cache-control': 'public, max-age=3600',
    },
  })
}

function parseUpstreamUrl(target: string | null): string | null {
  if (!target || target.length > 2048) return null
  try {
    const url = new URL(target)
    if (url.protocol !== 'https:' || url.hostname !== UPSTREAM_HOST) return null
    if (url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}
