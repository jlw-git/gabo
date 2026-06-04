// Top-venue freshness verifier. Runs weekly via /api/cron/verify-freshness.
//
// Why: cron syncs (dining, events, blogs) re-extract catalog rows but don't
// verify ongoing-ness — a restaurant could close on Monday, our weekly
// sync won't catch it until the Google Places refresh, and even then only
// if Google has marked the place closed. Users hit "Reserve" on a dead
// venue. This cron asks flash-lite (with Google Search grounding) "is this
// venue still operating?" for the top trending rows, and flips active=false
// or annotates badge_meta on hard/soft verdicts.
//
// Scope: editorial + trending_score-ranked subset only. Google Places and
// Foursquare rows already get freshness via their respective APIs, so this
// pass focuses on rows the agent stack ingested (blog, museum, eatbook).
// Capped at 50 rows/run to keep within Vercel function budget and Gemini
// quota — at $0.0001/call this is ~$0.005/run.

import { VERIFIER_MODEL } from '@/lib/agents/models'
import { debateVerdict, verify, type Verdict } from '@/lib/agents/runner'
import { agenticFlag } from '@/lib/agentic-flags'
import { createServiceRoleClient } from '@/lib/supabase/server'

const MAX_VENUES_PER_RUN = 50

type FreshnessRow = {
  id: string
  name: string
  address: string
  source: string
  source_url: string | null
  badge_meta: Record<string, unknown> | null
  trending_score: number
}

export type FreshnessSummary = {
  refreshed_at: string
  checked: number
  passed: number
  soft_flagged: number
  hard_rejected: number
  errors: string[]
}

function evidence(row: FreshnessRow): string {
  return `Venue:
- name: ${row.name}
- address: ${row.address}
${row.source_url ? `- last-known source URL: ${row.source_url}` : ''}`
}

const VERDICT_JSON =
  'Return ONLY raw JSON:\n{ "verdict": "pass" | "soft_flag" | "hard_reject", "confidence": <0..1>, "reason": "<≤200 chars>" }'

function judgePrompt(row: FreshnessRow): string {
  return `You are verifying that a Singapore venue is still operating today.

${evidence(row)}

Search the web for the most recent signals on this venue. Decide:
- "pass": there's clear recent evidence (news, reviews, social posts in the last few months) that the venue is open and operating normally.
- "soft_flag": signals are mixed or sparse — possibly slow business, possibly out of date, but no clear closure. Confidence 0.4–0.7.
- "hard_reject": you find clear evidence the venue has permanently closed, moved, or rebranded. Confidence ≥ 0.8.

${VERDICT_JSON}`
}

// Debate roles — same grounded search, opposed stances.
function proposerPrompt(row: FreshnessRow): string {
  return `You are DEFENDING that a Singapore venue is still open and operating. Search the web for evidence it's alive — recent reviews, social posts, an active listing, current hours.

${evidence(row)}

- "pass": you find recent evidence it's operating normally.
- "soft_flag": you can defend it but the signals are thin.
- "hard_reject": only if, searching in good faith, you find clear evidence it has permanently closed, moved, or rebranded.

${VERDICT_JSON}`
}

function skepticPrompt(row: FreshnessRow): string {
  return `You are a SKEPTIC checking whether a Singapore venue has CLOSED, moved, or rebranded. Search the web for closure signals — "permanently closed", closure news, removed/relocated listings, no recent activity.

${evidence(row)}

- "hard_reject" (confidence ≥ 0.8): clear evidence of permanent closure, relocation, or rebrand.
- "soft_flag": suspicious — stale or sparse signals — but no proof of closure.
- "pass": only if you find clear evidence it's still operating.
Default to hard_reject when the evidence strongly suggests it's gone.

${VERDICT_JSON}`
}

async function checkOne(row: FreshnessRow): Promise<Verdict> {
  // Debate mode (F4): grounded proposer + skeptic + deterministic tie-break.
  if (agenticFlag(process.env.AGENTIC_VERIFIER_DEBATE)) {
    return debateVerdict({
      proposerPrompt: proposerPrompt(row),
      skepticPrompt: skepticPrompt(row),
      model: VERIFIER_MODEL,
      timeoutMs: 25_000,
      groundWithSearch: true,
    })
  }
  return verify({
    model: VERIFIER_MODEL,
    prompt: judgePrompt(row),
    timeoutMs: 10_000,
    groundWithSearch: true,
  })
}

export async function runFreshnessVerifier(): Promise<FreshnessSummary> {
  const summary: FreshnessSummary = {
    refreshed_at: new Date().toISOString(),
    checked: 0,
    passed: 0,
    soft_flagged: 0,
    hard_rejected: 0,
    errors: [],
  }

  if (!process.env.GOOGLE_GEMINI_API_KEY) {
    summary.errors.push('GOOGLE_GEMINI_API_KEY not set — skipping')
    return summary
  }

  const supabase = createServiceRoleClient()
  // Editorial rows only, active, sorted by trending. Trending_score is the
  // best proxy for "venues users are about to actually plan around" — if it's
  // hot, we want freshness checked first.
  const { data, error } = await supabase
    .from('venues')
    .select('id, name, address, source, source_url, badge_meta, trending_score')
    .eq('source', 'editorial')
    .eq('active', true)
    .order('trending_score', { ascending: false })
    .limit(MAX_VENUES_PER_RUN)

  if (error) {
    summary.errors.push(`load: ${error.message}`)
    return summary
  }

  const rows = (data ?? []) as FreshnessRow[]

  for (const row of rows) {
    summary.checked++
    let verdict: Verdict
    try {
      verdict = await checkOne(row)
    } catch (err) {
      summary.errors.push(
        `${row.name}: ${err instanceof Error ? err.message : String(err)}`
      )
      continue
    }

    const today = new Date().toISOString().slice(0, 10)
    if (verdict.verdict === 'hard_reject') {
      summary.hard_rejected++
      const upd = await supabase
        .from('venues')
        .update({
          active: false,
          badge_meta: {
            ...(row.badge_meta ?? {}),
            freshness_deactivated_at: today,
            freshness_reason: verdict.reason,
          },
        })
        .eq('id', row.id)
      if (upd.error) summary.errors.push(`deactivate ${row.name}: ${upd.error.message}`)
    } else if (verdict.verdict === 'soft_flag') {
      summary.soft_flagged++
      const upd = await supabase
        .from('venues')
        .update({
          badge_meta: {
            ...(row.badge_meta ?? {}),
            freshness_flagged: today,
            freshness_reason: verdict.reason,
          },
        })
        .eq('id', row.id)
      if (upd.error) summary.errors.push(`flag ${row.name}: ${upd.error.message}`)
    } else {
      summary.passed++
      // Clear any prior soft flag so a recovered venue's annotation doesn't
      // linger forever. Only writes if there was a flag to clear.
      const meta = row.badge_meta ?? {}
      if ('freshness_flagged' in meta || 'freshness_reason' in meta) {
        const next: Record<string, unknown> = { ...meta }
        delete next.freshness_flagged
        delete next.freshness_reason
        const upd = await supabase.from('venues').update({ badge_meta: next }).eq('id', row.id)
        if (upd.error) summary.errors.push(`clear-flag ${row.name}: ${upd.error.message}`)
      }
    }
  }

  return summary
}
