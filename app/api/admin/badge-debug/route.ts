import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'

// Ops endpoint: reports badge_meta coverage across the dining catalog so we
// can diagnose "filter tabs empty" issues without grepping /api/recommendations
// JSON. Counts how many dining rows have each badge-driving field set, and
// returns a few sample names per category so we can spot-check what Gemini
// is producing.
//
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     https://<host>/api/admin/badge-debug
//
// Same CRON_SECRET gate as the other admin endpoints.

async function handle(request: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (expected) {
    const got = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (got !== expected) {
      return Response.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  const supabase = createServiceRoleClient()
  // Pull just the fields we need — keeps the payload small even on large
  // catalogs. Limit to editorial / api-sourced dining rows; museum is the
  // event source and doesn't go through the blog scanner.
  const { data, error } = await supabase
    .from('venues')
    .select('id, name, source, source_id, badge, badge_meta, cuisine_tags, last_synced_at')
    .in('source', ['editorial', 'google_places', 'foursquare'])
    .eq('active', true)
    .limit(2000)
  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }
  const rows = data ?? []

  // Dining = rows whose cuisine_tags do NOT include the 'experience' marker.
  // (Mirrors lib/planner/category.ts#isEvent.)
  const dining = rows.filter((r) => !(r.cuisine_tags ?? []).includes('experience'))

  const withOpened = dining.filter((r) => typeof r.badge_meta?.opened === 'string')
  const withEndsAt = dining.filter((r) => typeof r.badge_meta?.ends_at === 'string')
  const withSource = dining.filter((r) => typeof r.badge_meta?.source === 'string')
  const withAward = dining.filter((r) => typeof r.badge_meta?.award === 'string')

  const byBadge: Record<string, number> = {}
  for (const r of dining) {
    byBadge[r.badge ?? 'null'] = (byBadge[r.badge ?? 'null'] ?? 0) + 1
  }

  // Most-recent sync timestamps per source — confirms what actually ran.
  const lastSyncedBySource: Record<string, string> = {}
  for (const r of dining) {
    const src = r.source ?? 'unknown'
    const t = r.last_synced_at
    if (typeof t !== 'string') continue
    if (!lastSyncedBySource[src] || t > lastSyncedBySource[src]) {
      lastSyncedBySource[src] = t
    }
  }

  function sample(rs: typeof dining, n = 5) {
    return rs.slice(0, n).map((r) => ({
      name: r.name,
      source_id: r.source_id,
      badge: r.badge,
      badge_meta: r.badge_meta,
    }))
  }

  return Response.json({
    dining_total: dining.length,
    by_badge: byBadge,
    counts: {
      with_opened: withOpened.length,
      with_ends_at: withEndsAt.length,
      with_source: withSource.length,
      with_award: withAward.length,
    },
    last_synced_by_source: lastSyncedBySource,
    samples: {
      with_opened: sample(withOpened),
      with_ends_at: sample(withEndsAt),
      with_source: sample(withSource),
      with_award: sample(withAward),
    },
  })
}

export const GET = handle
export const POST = handle
