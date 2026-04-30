import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncDiningCatalog } from '@/lib/sources/dining-sync'
import { syncEventsCatalog } from '@/lib/sources/events-sync'
import { refreshTrendingScores } from '@/lib/trending/refresh'

// One-shot full catalog rebuild from real sources:
//   1. Delete every legacy hand-seeded row (source IS NULL or 'manual')
//   2. Run the dining sync (Google Places → Foursquare fallback)
//   3. Run the events sync (Bandsintown + editorial)
//   4. Refresh trending scores (Reddit + shortlist velocity)
//
// Gate behind CRON_TOKEN. Run once after migrations 0003 + 0004 are applied
// and the relevant API keys are in env. Subsequent refreshes happen via the
// scheduled crons in vercel.json.
//
//   curl -X POST -H "Authorization: Bearer $CRON_TOKEN" \
//     https://<host>/api/admin/reseed

export const maxDuration = 300

export async function POST(request: NextRequest) {
  const expected = process.env.CRON_TOKEN
  if (!expected) {
    return Response.json(
      { error: 'CRON_TOKEN must be set to use this endpoint' },
      { status: 403 }
    )
  }
  const got = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (got !== expected) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const result = {
    started_at: new Date().toISOString(),
    legacy_rows_deleted: 0,
    dining: null as Awaited<ReturnType<typeof syncDiningCatalog>> | null,
    events: null as Awaited<ReturnType<typeof syncEventsCatalog>> | null,
    trending: null as Awaited<ReturnType<typeof refreshTrendingScores>> | null,
    errors: [] as string[],
  }

  try {
    const supabase = await createClient()
    const { error, count } = await supabase
      .from('venues')
      .delete({ count: 'exact' })
      .or('source.is.null,source.eq.manual')
    if (error) {
      result.errors.push(`legacy delete: ${error.message}`)
    } else {
      result.legacy_rows_deleted = count ?? 0
    }
  } catch (err) {
    result.errors.push(`legacy delete threw: ${err instanceof Error ? err.message : err}`)
  }

  try {
    result.dining = await syncDiningCatalog()
  } catch (err) {
    result.errors.push(`dining sync: ${err instanceof Error ? err.message : err}`)
  }

  try {
    result.events = await syncEventsCatalog()
  } catch (err) {
    result.errors.push(`events sync: ${err instanceof Error ? err.message : err}`)
  }

  try {
    result.trending = await refreshTrendingScores()
  } catch (err) {
    result.errors.push(`trending refresh: ${err instanceof Error ? err.message : err}`)
  }

  return Response.json(result)
}
