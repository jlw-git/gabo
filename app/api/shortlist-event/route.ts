import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Anonymous logger for shortlist toggles. Powers the internal-velocity
// component of the trending score. Single field: venue_id.
//
// Body: { venue_id: string }
// Best-effort — never blocks the client UI.

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }

  const venueId = (body as { venue_id?: unknown })?.venue_id
  if (typeof venueId !== 'string' || venueId.length < 8) {
    return Response.json({ ok: false, error: 'venue_id required' }, { status: 400 })
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.from('shortlist_events').insert({ venue_id: venueId })
    if (error) {
      // Don't surface DB errors to the client — this is fire-and-forget.
      return Response.json({ ok: false }, { status: 200 })
    }
    return Response.json({ ok: true })
  } catch {
    return Response.json({ ok: false }, { status: 200 })
  }
}
