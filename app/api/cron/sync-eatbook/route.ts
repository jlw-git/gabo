import { NextRequest } from 'next/server'
import { syncEatbookNewOpenings } from '@/lib/sources/eatbook-rss'

// Discovers new Singapore restaurant openings via Eatbook RSS feeds, resolves
// them through Google Places, and inserts genuinely new venues with
// badge:'soft_launch'. Weekly cron (Mon 07:00 UTC, after dining sync).
// Run manually: curl -H "Authorization: Bearer $CRON_TOKEN" https://<host>/api/cron/sync-eatbook

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
    const summary = await syncEatbookNewOpenings()
    return Response.json(summary)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}

export const POST = GET
