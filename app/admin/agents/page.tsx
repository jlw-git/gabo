// /admin/agents — observability surface for the agentic layer.
//
// Renders one panel per cron kind (blogs / museums / freshness / dining)
// reading from agent_run_log, plus a "last plan meta" panel that submits
// a baked-in fixture to /api/plan and prints meta.agent_relaxation +
// meta.ranker so we can see the request-time agents in action without
// running the full UI.
//
// Gating: ?token=<CRON_SECRET> on the URL. Same pattern as /api/admin/reseed.
// We avoid a separate auth system because this is a single internal page
// and the value of the dashboard is exactly what's in the run log — no
// reason to put more friction in front of it.

import { headers } from 'next/headers'
import { loadRecentRuns, type AgentRunRow, type RunKind } from '@/lib/agents/run-log'

export const dynamic = 'force-dynamic'

type Search = { searchParams: Promise<{ token?: string }> }

export default async function AgentsAdminPage({ searchParams }: Search) {
  const { token } = await searchParams
  const expected = process.env.CRON_SECRET

  if (expected && token !== expected) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12 text-stone-700">
        <h1 className="text-xl font-semibold">Unauthorized</h1>
        <p className="mt-2 text-sm text-stone-500">
          Pass <code>?token=&lt;CRON_SECRET&gt;</code> on the URL.
        </p>
      </main>
    )
  }

  // Pull all four kinds in parallel. Each loadRecentRuns swallows its own
  // errors and returns []; one failed query won't blank the page.
  const [blogs, museums, freshness, dining] = await Promise.all([
    loadRecentRuns('blogs'),
    loadRecentRuns('museums'),
    loadRecentRuns('freshness'),
    loadRecentRuns('dining'),
  ])

  const planMeta = await loadLastPlanMeta()

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-6 py-10 text-stone-800">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Agent observability</h1>
        <p className="mt-1 text-sm text-stone-500">
          Recent cron summaries (last 4 weeks) and one live <code>/api/plan</code> sample.
        </p>
      </header>

      <RunPanel kind="blogs" rows={blogs} />
      <RunPanel kind="museums" rows={museums} />
      <RunPanel kind="freshness" rows={freshness} />
      <RunPanel kind="dining" rows={dining} />

      <PlanMetaPanel meta={planMeta} />
    </main>
  )
}

// Per-kind panel. Computes verifier health (% pass/soft/hard) on the rolling
// window AND lists the last few raw runs so weird single-run blips are
// visible without losing the aggregate view.
function RunPanel({ kind, rows }: { kind: RunKind; rows: AgentRunRow[] }) {
  const stats = aggregateVerifierStats(kind, rows)
  const recent = rows.slice(0, 5)

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold capitalize">{kind}</h2>
        <p className="text-xs text-stone-500">
          {rows.length} runs in window · last {rows[0] ? formatWhen(rows[0].created_at) : '—'}
        </p>
      </div>

      {stats ? (
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          <Stat label="Total considered" value={stats.total.toLocaleString()} />
          <Stat
            label="% verified"
            value={pct(stats.verified, stats.total)}
            tone={stats.total > 0 ? 'ok' : 'neutral'}
          />
          <Stat
            label="% soft-flagged"
            value={pct(stats.soft, stats.total)}
            tone={stats.total > 0 && stats.soft / stats.total > 0.15 ? 'warn' : 'neutral'}
          />
          <Stat
            label="% hard-rejected"
            value={pct(stats.hard, stats.total)}
            tone={statHardTone(stats.hard, stats.total)}
          />
        </dl>
      ) : (
        <p className="mt-3 text-sm text-stone-500">No verifier counts in summaries for this kind.</p>
      )}

      {recent.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-stone-600">Recent runs ({recent.length})</summary>
          <div className="mt-2 space-y-2">
            {recent.map((row) => (
              <div key={row.id} className="rounded-lg bg-stone-50 p-3 text-xs">
                <div className="mb-1 font-medium text-stone-700">{formatWhen(row.created_at)}</div>
                <RunRowBody row={row} />
              </div>
            ))}
          </div>
        </details>
      )}

      {rows.length === 0 && (
        <p className="mt-3 text-sm text-stone-500">No runs in the last 4 weeks.</p>
      )}
    </section>
  )
}

function RunRowBody({ row }: { row: AgentRunRow }) {
  const s = row.summary
  // Show the headline counts inline; full JSON in a nested details for the
  // curious. Cron summaries are 5–30 keys typically so this keeps the page
  // scannable.
  const headline: [string, unknown][] = []
  for (const k of [
    'upserted',
    'verified',
    'soft_flagged',
    'hard_rejected',
    'passed',
    'deactivated',
    'addresses_validated',
    'errors',
  ]) {
    const v = s[k]
    if (v === undefined) continue
    if (Array.isArray(v)) headline.push([k, `${v.length} ${v.length === 1 ? 'item' : 'items'}`])
    else headline.push([k, v])
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-4">
        {headline.map(([k, v]) => (
          <div key={k} className="truncate">
            <span className="text-stone-500">{k}: </span>
            <span className="font-mono">{String(v)}</span>
          </div>
        ))}
      </div>
      {Array.isArray(s.errors) && s.errors.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-rose-700">errors ({(s.errors as unknown[]).length})</summary>
          <ul className="mt-1 space-y-0.5 text-stone-600">
            {(s.errors as string[]).slice(0, 5).map((e, i) => (
              <li key={i} className="truncate font-mono">{e}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}

function PlanMetaPanel({ meta }: { meta: PlanMetaSnapshot | null }) {
  if (!meta) {
    return (
      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Last plan meta sample</h2>
        <p className="mt-2 text-sm text-stone-500">
          Could not fetch a sample plan. Is the dev server up and OneMap configured?
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold">Last plan meta sample</h2>
      <p className="mt-1 text-xs text-stone-500">
        Submitted to <code>/api/plan</code> at page load with a fixture payload. Flag state:
        AGENTIC_PLAN_ENABLED={String(process.env.AGENTIC_PLAN_ENABLED === 'true')} ·
        AGENTIC_RANKER_ENABLED={String(process.env.AGENTIC_RANKER_ENABLED === 'true')}
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <Stat label="dining cards" value={String(meta.dining_count)} />
        <Stat label="events cards" value={String(meta.events_count)} />
        <Stat label="gemini enriched" value={String(meta.gemini_enriched)} />
        <Stat
          label="ranker (D/E)"
          value={`${meta.ranker.dining} / ${meta.ranker.events}`}
        />
      </dl>

      {meta.agent_relaxation && meta.agent_relaxation.length > 0 && (
        <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          <div className="font-semibold">Relaxation fired:</div>
          {meta.agent_relaxation.map((r, i) => (
            <div key={i} className="mt-0.5">
              {r.bucket}: dropped {r.dropped.join(', ')} → +{r.delta}{' '}
              {r.reason && <span className="italic">({r.reason})</span>}
            </div>
          ))}
        </div>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-stone-600">Full meta JSON</summary>
        <pre className="mt-2 overflow-auto rounded-lg bg-stone-50 p-3 text-[11px] leading-snug">
          {JSON.stringify(meta.raw, null, 2)}
        </pre>
      </details>
    </section>
  )
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'ok' | 'warn' | 'bad' | 'neutral'
}) {
  const toneClass =
    tone === 'ok'
      ? 'text-emerald-700'
      : tone === 'warn'
        ? 'text-amber-700'
        : tone === 'bad'
          ? 'text-rose-700'
          : 'text-stone-800'
  return (
    <div className="rounded-lg bg-stone-50 px-3 py-2">
      <dt className="text-xs uppercase tracking-wider text-stone-500">{label}</dt>
      <dd className={`mt-0.5 text-base font-semibold ${toneClass}`}>{value}</dd>
    </div>
  )
}

// Verifier rate aggregation. Different summary shapes carry slightly
// different counter names — freshness uses `passed` instead of `verified` —
// so we normalise here.
function aggregateVerifierStats(
  kind: RunKind,
  rows: AgentRunRow[]
): { verified: number; soft: number; hard: number; total: number } | null {
  let verified = 0
  let soft = 0
  let hard = 0
  let any = false
  for (const r of rows) {
    const s = r.summary
    const v = kind === 'freshness' ? toNum(s.passed) : toNum(s.verified)
    const sf = toNum(s.soft_flagged)
    const hr = toNum(s.hard_rejected)
    if (v === null && sf === null && hr === null) continue
    any = true
    verified += v ?? 0
    soft += sf ?? 0
    hard += hr ?? 0
  }
  if (!any) return null
  return { verified, soft, hard, total: verified + soft + hard }
}

function statHardTone(hard: number, total: number): 'ok' | 'warn' | 'bad' | 'neutral' {
  if (total === 0) return 'neutral'
  const r = hard / total
  // Mirrors the plan's rollout criteria: 2–20% is healthy.
  if (r < 0.02) return 'warn' // verifier not earning its cost
  if (r > 0.2) return 'bad' // prompt too strict, tune
  return 'ok'
}

function pct(n: number, d: number): string {
  if (d === 0) return '—'
  return `${((100 * n) / d).toFixed(1)}%`
}

function toNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Fixture submitted to /api/plan to surface live meta. Deliberately broad
// (no start points, generous profile) so it works even when the dining
// catalog is sparse — the dashboard's value isn't ranking quality, it's
// confirming the flags are active.
type PlanMetaSnapshot = {
  dining_count: number
  events_count: number
  gemini_enriched: number
  ranker: { dining: number; events: number }
  agent_relaxation:
    | { bucket: 'dining' | 'events'; dropped: string[]; reason: string; delta: number }[]
    | null
  raw: Record<string, unknown>
}

async function loadLastPlanMeta(): Promise<PlanMetaSnapshot | null> {
  try {
    const hdrs = await headers()
    const host =
      hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? `localhost:${process.env.PORT ?? 3000}`
    const proto = hdrs.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')

    // Build an SGT scheduled_for for the next Saturday 19:00. Stable enough
    // that re-renders cache (Vercel CDN) when nothing else changed.
    const now = new Date()
    const sat = new Date(now)
    sat.setUTCDate(now.getUTCDate() + ((6 - now.getUTCDay() + 7) % 7 || 7))
    sat.setUTCHours(11, 0, 0, 0) // 19:00 SGT = 11:00 UTC

    const body = {
      scheduled_for: sat.toISOString(),
      profile: {
        planner_name: 'Sample',
        partner_name: 'Sample',
        cuisines_loved: [],
        cuisines_avoided: [],
        dietary_hardstops: [],
        vibe_defaults: [],
        budget_bands: [],
        transit_pref: 'either' as const,
      },
      override_tags: [],
      shortlist_ids: [],
    }

    const res = await fetch(`${proto}://${host}/api/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const json = (await res.json()) as {
      buckets?: { dining?: unknown[]; events?: unknown[] }
      meta?: Record<string, unknown>
    }
    const meta = json.meta ?? {}
    const ranker = (meta.ranker as { dining?: number; events?: number } | undefined) ?? {}
    return {
      dining_count: json.buckets?.dining?.length ?? 0,
      events_count: json.buckets?.events?.length ?? 0,
      gemini_enriched: toNum(meta.gemini_enriched) ?? 0,
      ranker: { dining: ranker.dining ?? 0, events: ranker.events ?? 0 },
      agent_relaxation:
        (meta.agent_relaxation as PlanMetaSnapshot['agent_relaxation']) ?? null,
      raw: meta,
    }
  } catch {
    return null
  }
}
