import { NextRequest } from 'next/server'
import { OneMapApiError, OneMapAuthError, fetchTransitRoute } from '@/lib/onemap/client'
import { parseLatLng } from '@/lib/planner/request-validation'

// Real public-transit ETA via OneMap pt routing. Called lazily by the
// FairnessPill when the user toggles to transit mode — keeps planning fast
// (drive-only) and only pays the routing cost for cards the user actually
// wants transit times for.
//
// Body: { origin: {lat,lng}, destination: {lat,lng}, scheduled_for: ISO }

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: 'origin, destination and scheduled_for required' }, { status: 400 })
  }

  const payload = body as Record<string, unknown>
  const origin = parseLatLng(payload.origin)
  const destination = parseLatLng(payload.destination)
  const scheduledForStr = typeof payload.scheduled_for === 'string' ? payload.scheduled_for : null
  const scheduledFor = scheduledForStr ? new Date(scheduledForStr) : null

  if (!origin || !destination || !scheduledFor || Number.isNaN(scheduledFor.getTime())) {
    return Response.json(
      { error: 'origin, destination and scheduled_for required (valid ISO date)' },
      { status: 400 }
    )
  }

  try {
    const route = await fetchTransitRoute(origin, destination, scheduledFor)
    return Response.json({
      duration_min: Math.round(route.duration_sec / 60),
      walk_distance_m: route.walk_distance_m,
      legs: route.legs,
      cached: route.cached === true,
    })
  } catch (err) {
    if (err instanceof OneMapAuthError) {
      return Response.json({ error: err.message }, { status: 500 })
    }
    if (err instanceof OneMapApiError) {
      return Response.json({ error: err.message }, { status: 502 })
    }
    const message = err instanceof Error ? err.message : 'unknown error'
    return Response.json({ error: message }, { status: 502 })
  }
}
