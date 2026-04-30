import { NextRequest } from 'next/server'
import { refreshTrendingScores } from '@/lib/trending/refresh'

// Recomputes trending_score for all venues from real signals (Reddit + shortlist
// velocity). Wire to a weekly Vercel Cron via vercel.json or hit manually:
//   curl -H "Authorization: Bearer $CRON_TOKEN" https://<host>/api/cron/trending

export const maxDuration = 300 // up to 5min — Reddit calls dominate

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_TOKEN
  if (expected) {
    const got = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (got !== expected) {
      return Response.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  try {
    const summary = await refreshTrendingScores()
    return Response.json(summary)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}

// Allow POST too — Vercel Cron uses GET, but this is convenient for manual runs.
export const POST = GET
