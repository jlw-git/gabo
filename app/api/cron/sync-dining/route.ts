import { NextRequest } from 'next/server'
import { recordRun } from '@/lib/agents/run-log'
import { syncDiningCatalog } from '@/lib/sources/dining-sync'

// Refreshes the dining catalog from Google Places (with Foursquare fallback).
// Wire to a weekly Vercel Cron via vercel.json or hit manually:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/sync-dining

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
    const summary = await syncDiningCatalog()
    await recordRun('dining', summary)
    return Response.json(summary)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}

export const POST = GET
