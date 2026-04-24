import { NextRequest } from 'next/server'
import { fetchDirection } from '@/lib/grabmaps/direction'
import { parseLatLng } from '@/lib/planner/request-validation'

// Thin proxy for single origin→destination lookups from the client.
// The plan handler (/api/plan) calls `fetchDirection` directly for batch work.

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: 'origin and destination required' }, { status: 400 })
  }

  const payload = body as Record<string, unknown>
  const origin = parseLatLng(payload.origin)
  const destination = parseLatLng(payload.destination)
  const profile = parseProfile(payload.profile)

  if (!origin || !destination) {
    return Response.json({ error: 'valid Singapore origin and destination required' }, { status: 400 })
  }

  try {
    const result = await fetchDirection(origin, destination, profile)
    return Response.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return Response.json({ error: message }, { status: 502 })
  }
}

function parseProfile(value: unknown): 'driving' | 'walking' | 'cycling' | 'motorcycle' | undefined {
  if (
    value === 'driving' ||
    value === 'walking' ||
    value === 'cycling' ||
    value === 'motorcycle'
  ) {
    return value
  }
  return undefined
}
