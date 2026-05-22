import { NextRequest } from 'next/server'
import { recordRun } from '@/lib/agents/run-log'
import { runFreshnessVerifier } from '@/lib/agents/verifiers/freshness'

// Weekly LLM-as-judge pass over the top trending editorial rows. Hard
// rejects (clearly closed) flip active=false; soft flags annotate
// badge_meta.freshness_flagged. Pairs with the cron entry in vercel.json.
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/verify-freshness

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
    const summary = await runFreshnessVerifier()
    await recordRun('freshness', summary)
    return Response.json(summary)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}

export const POST = GET
