import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { syncDiningCatalog } from '@/lib/sources/dining-sync'
import { syncEventsCatalog } from '@/lib/sources/events-sync'
import { refreshTrendingScores } from '@/lib/trending/refresh'

// One-shot full catalog rebuild from real sources:
//   1. Delete ALL rows from the venues table
//   2. Run the dining sync (Google Places → Foursquare fallback)
//   3. Run the events sync (Bandsintown + museum scrapers + editorial)
//   4. Refresh trending scores (Reddit + shortlist velocity)
//
// Gate behind CRON_TOKEN (if set). Safe to call from localhost without token
// when CRON_TOKEN is unset in the environment.
//
//   curl -X POST -H "Authorization: Bearer $CRON_TOKEN" \
//     https://<host>/api/admin/reseed

export const maxDuration = 300

export async function POST(request: NextRequest) {
  const expected = process.env.CRON_TOKEN
  if (expected) {
    const got = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (got !== expected) {
      return Response.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  const result = {
    started_at: new Date().toISOString(),
    rows_deleted: 0,
    dining: null as Awaited<ReturnType<typeof syncDiningCatalog>> | null,
    events: null as Awaited<ReturnType<typeof syncEventsCatalog>> | null,
    trending: null as Awaited<ReturnType<typeof refreshTrendingScores>> | null,
    errors: [] as string[],
  }

  try {
    // Service role client bypasses RLS for the destructive delete.
    const admin = createServiceRoleClient()
    const { error, count } = await admin
      .from('venues')
      .delete({ count: 'exact' })
      .neq('id', '00000000-0000-0000-0000-000000000000')
    if (error) {
      result.errors.push(`delete all: ${error.message}`)
    } else {
      result.rows_deleted = count ?? 0
    }
  } catch (err) {
    result.errors.push(`delete threw: ${err instanceof Error ? err.message : err}`)
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
