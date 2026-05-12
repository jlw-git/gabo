import { NextRequest } from 'next/server'
import { syncEventsCatalog } from '@/lib/sources/events-sync'

// Manual "refresh now" trigger for the events catalog — same body as the
// daily /api/cron/sync-events but lives under /admin/ so it's discoverable
// as an ops surface. Same CRON_SECRET gate.
//
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//     https://<host>/api/admin/sync-events-now
//
// Response is the EventsSyncSummary, including per-source counts and any
// per-source error strings — useful for confirming the new Esplanade / TSL
// sources are populating after a code change without waiting for cron.

export const maxDuration = 300

async function handle(request: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (expected) {
    const got = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (got !== expected) {
      return Response.json({ error: 'unauthorized' }, { status: 401 })
    }
  }
  try {
    const summary = await syncEventsCatalog()
    return Response.json(summary)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
