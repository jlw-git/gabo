import { NextRequest } from 'next/server'
import { agenticFlag } from '@/lib/agentic-flags'
import { composeItinerary } from '@/lib/planner/itinerary'
import type { PlanCard, TransitMode } from '@/lib/planner/types'

// Whole-evening itinerary composition (F2). On-demand: the client sends the
// buckets it already has on screen (no re-plan) plus the slot + ETA mode; we
// compose dinner→activity evenings with travel legs and timing feasibility.
//
// Body: { dining: PlanCard[], events: PlanCard[], scheduled_for: string, mode?: 'drive'|'transit' }
// Returns: { itineraries: Itinerary[] }
//
// Gated by AGENTIC_ITINERARY_ENABLED. Never throws on compose failure — returns
// an empty list so the UI shows a clean "no evening fits" state.

function parseCards(value: unknown): PlanCard[] {
  if (!Array.isArray(value)) return []
  // The cards originate from our own /api/plan response; trust the shape but
  // drop anything missing the fields the composer needs (coords + name).
  return value.filter(
    (c): c is PlanCard =>
      !!c &&
      typeof c === 'object' &&
      typeof (c as PlanCard).name === 'string' &&
      typeof (c as PlanCard).lat === 'number' &&
      typeof (c as PlanCard).lng === 'number'
  )
}

export async function POST(request: NextRequest) {
  if (!agenticFlag(process.env.AGENTIC_ITINERARY_ENABLED)) {
    return Response.json({ error: 'not found' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: 'invalid body' }, { status: 400 })
  }

  const b = body as Record<string, unknown>
  const dining = parseCards(b.dining)
  const events = parseCards(b.events)
  const scheduledFor = typeof b.scheduled_for === 'string' ? new Date(b.scheduled_for) : null
  if (!scheduledFor || Number.isNaN(scheduledFor.getTime())) {
    return Response.json({ error: 'valid scheduled_for required' }, { status: 400 })
  }
  const mode: TransitMode = b.mode === 'drive' ? 'drive' : 'transit'

  try {
    const itineraries = await composeItinerary({ dining, events, scheduledFor, mode })
    return Response.json({ itineraries })
  } catch (err) {
    console.error('[itinerary] failed', err)
    return Response.json({ itineraries: [] })
  }
}
