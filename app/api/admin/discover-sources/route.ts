import { NextRequest } from 'next/server'
import { discoverSources } from '@/lib/sources/source-discovery'
import { recordRun } from '@/lib/agents/run-log'

// Autonomous source discovery (F4). Admin-triggered (review-gated, not a
// scheduled cron): proposes new Singapore editorial sources for human review.
// Candidates are de-duped against current sources + reachability-checked; nothing
// is auto-added to the scan list. Recorded to agent_run_log('source-discovery').
//
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/admin/discover-sources

export const maxDuration = 120

async function handle(request: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (expected) {
    const got = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (got !== expected) {
      return Response.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  const summary = await discoverSources()
  await recordRun('source-discovery', summary)
  return Response.json(summary)
}

export const GET = handle
export const POST = handle
