import { NextRequest } from 'next/server'
import { syncEventsCatalog } from '@/lib/sources/events-sync'

// Refreshes the events catalog from Bandsintown (concerts) + SAM/NGS scrapers
// + editorial (ArtScience, NHB, Gardens, Esplanade). Daily cron.
// Run manually: curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/sync-events
//
// maxDuration bumped to 300s: NGS scraper fetches up to 20 detail pages in
// parallel, which can take 15–30 s on cold starts.

export const maxDuration = 300

export async function GET(request: NextRequest) {
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

export const POST = GET
