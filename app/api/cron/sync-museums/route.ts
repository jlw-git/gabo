import { NextRequest } from 'next/server'
import { runMuseumAgent } from '@/lib/sources/museum-agent'

// Monthly museum exhibition discovery. Uses Claude + web search to find
// current and upcoming exhibitions at ArtScience Museum, NHB, and Gardens
// by the Bay -- sites that are JS-rendered and not fetch()-scrapeable.
// Run manually: curl -H "Authorization: Bearer $CRON_TOKEN" https://<host>/api/cron/sync-museums
//
// Requires ANTHROPIC_API_KEY in env.

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
    const summary = await runMuseumAgent()
    return Response.json(summary)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}

export const POST = GET
