// Records cron run summaries to agent_run_log. Each cron route calls
// recordRun() once before returning so the /admin/agents dashboard has
// something to render. Failures here NEVER throw — observability must
// not be able to break the actual sync work.

import { createServiceRoleClient } from '@/lib/supabase/server'

export type RunKind =
  | 'blogs'
  | 'museums'
  | 'freshness'
  | 'dining'
  | 'conversation'
  | 'itinerary'
  | 'source-discovery'

export async function recordRun(kind: RunKind, summary: unknown): Promise<void> {
  try {
    const supabase = createServiceRoleClient()
    const { error } = await supabase.from('agent_run_log').insert({
      kind,
      summary,
    })
    if (error) {
      // Log but don't throw — the actual cron work has already succeeded
      // by the time we record. Losing one observability row is fine.
      console.error(`[run-log] insert ${kind} failed:`, error.message)
    }
  } catch (err) {
    console.error(
      `[run-log] insert ${kind} threw:`,
      err instanceof Error ? err.message : String(err)
    )
  }
}

export type AgentRunRow = {
  id: string
  kind: RunKind
  summary: Record<string, unknown>
  created_at: string
}

// Read helper used by the admin dashboard. Returns the most recent `limit`
// rows for `kind` from the last `weeks` weeks. Defaults to 4 weeks × 20 rows
// per kind — generous enough for weekly + monthly crons.
export async function loadRecentRuns(
  kind: RunKind,
  opts: { weeks?: number; limit?: number } = {}
): Promise<AgentRunRow[]> {
  const weeks = opts.weeks ?? 4
  const limit = opts.limit ?? 20
  const supabase = createServiceRoleClient()
  const cutoff = new Date(Date.now() - weeks * 7 * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('agent_run_log')
    .select('*')
    .eq('kind', kind)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error(`[run-log] load ${kind} failed:`, error.message)
    return []
  }
  return (data ?? []) as AgentRunRow[]
}
