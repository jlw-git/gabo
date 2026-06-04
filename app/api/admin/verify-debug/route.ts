import { NextRequest } from 'next/server'
import { agenticFlag } from '@/lib/agentic-flags'
import { verifyBlogExtraction, type BlogVerifierInput } from '@/lib/agents/verifiers/blog-extraction'

// Ops endpoint: exercise the blog-extraction verifier on a supplied article +
// extracted venue, without running the full sync-blogs cron or touching the DB.
// Used to tune the proposer/skeptic debate (F4) and spot-check verdicts.
//
//   curl -H "Authorization: Bearer $CRON_SECRET" -H 'Content-Type: application/json' \
//     -d '{"articleText":"...","venue":{"name":"...","address":"..."},"debate":true}' \
//     https://<host>/api/admin/verify-debug
//
// Same CRON_SECRET gate as the other admin endpoints. `debate` overrides the
// AGENTIC_VERIFIER_DEBATE env flag for this call (omit to use the env default).
// The returned verdict's `reason` carries both sides' arguments when debating
// ("keep: … | reject: …").

export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (expected) {
    const got = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (got !== expected) {
      return Response.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: 'invalid body' }, { status: 400 })
  }

  const b = body as Record<string, unknown>
  const v = (b.venue ?? {}) as Record<string, unknown>
  const articleText = typeof b.articleText === 'string' ? b.articleText : ''
  const name = typeof v.name === 'string' ? v.name : ''
  const address = typeof v.address === 'string' ? v.address : ''
  if (!articleText || !name) {
    return Response.json({ error: 'articleText and venue.name required' }, { status: 400 })
  }

  const input: BlogVerifierInput = {
    articleText,
    venue: {
      name,
      address,
      opens_at: typeof v.opens_at === 'string' ? v.opens_at : null,
      ends_at: typeof v.ends_at === 'string' ? v.ends_at : null,
      starts_at: typeof v.starts_at === 'string' ? v.starts_at : null,
    },
  }
  const debate = typeof b.debate === 'boolean' ? b.debate : undefined

  const verdict = await verifyBlogExtraction(input, { debate })
  return Response.json({
    debate: debate ?? agenticFlag(process.env.AGENTIC_VERIFIER_DEBATE),
    verdict,
  })
}
