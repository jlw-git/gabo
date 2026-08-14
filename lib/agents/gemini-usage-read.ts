import { createServiceRoleClient } from '@/lib/supabase/server'

export type GeminiUsageRow = {
  id: string
  feature: string
  provider: 'gemini' | 'openrouter'
  model: string
  grounded: boolean
  tool_call_count: number
  tool_calls: unknown[]
  prompt_preview: string
  prompt_chars: number
  output_chars: number
  duration_ms: number
  ok: boolean
  error_message: string | null
  route_path: string | null
  ip_hash: string | null
  user_agent_hash: string | null
  created_at: string
}

export type GeminiUsageStats = {
  total: number
  ok: number
  failed: number
  grounded: number
  byFeature: { feature: string; count: number; failed: number; grounded: number }[]
}

export async function loadRecentGeminiUsage(opts: {
  hours?: number
  limit?: number
} = {}): Promise<{ rows: GeminiUsageRow[]; stats: GeminiUsageStats | null }> {
  const hours = opts.hours ?? 24 * 7
  const limit = opts.limit ?? 50
  const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString()
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('gemini_usage_log')
    .select('*')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[gemini-usage-log] load failed:', error.message)
    return { rows: [], stats: null }
  }

  const rows = (data ?? []) as GeminiUsageRow[]
  return { rows, stats: summarise(rows) }
}

function summarise(rows: GeminiUsageRow[]): GeminiUsageStats {
  const byFeature = new Map<string, { feature: string; count: number; failed: number; grounded: number }>()
  let ok = 0
  let grounded = 0
  for (const row of rows) {
    if (row.ok) ok += 1
    if (row.grounded) grounded += 1
    const current = byFeature.get(row.feature) ?? {
      feature: row.feature,
      count: 0,
      failed: 0,
      grounded: 0,
    }
    current.count += 1
    if (!row.ok) current.failed += 1
    if (row.grounded) current.grounded += 1
    byFeature.set(row.feature, current)
  }
  return {
    total: rows.length,
    ok,
    failed: rows.length - ok,
    grounded,
    byFeature: [...byFeature.values()].sort((a, b) => b.count - a.count),
  }
}
