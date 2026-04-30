import { NextRequest } from 'next/server'
import { syncEventsCatalog } from '@/lib/sources/events-sync'

// Refreshes the events catalog from Bandsintown (concerts) + editorial
// (curated exhibitions/pop-ups). Daily cron — events change faster than
// restaurants. Wire via vercel.json or run manually:
//   curl -H "Authorization: Bearer $CRON_TOKEN" https://<host>/api/cron/sync-events

export const maxDuration = 120

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_TOKEN
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

export const POST = GET
