// Shared LLM call helpers used by every agent in the app. Provider dispatch
// (OpenRouter vs direct Gemini) lives in ./provider — this file keeps the small,
// stable primitives on top of it: generateJson (tolerant JSON), verify
// (LLM-as-judge), generateWithTools (bounded tool-use loop), and the F4 debate.

import {
  chatComplete,
  chatCompleteWithTools,
  type ProviderTool,
  type ToolCall,
  type ToolLoopResult,
} from '@/lib/agents/provider'

export type GenerateJsonOptions = {
  model: string
  prompt: string
  // Wall-clock budget — on expiry the call resolves to null so callers can
  // gracefully degrade. Default 8s (matches the existing gemini-eval budget).
  timeoutMs?: number
  // When true, attaches Google Search grounding (used by museum + freshness).
  groundWithSearch?: boolean
}

// Generic JSON-shaped call. Returns the parsed value or null on any failure
// (timeout, network, empty response, unparseable output). The caller does
// the shape-validation — runner stays generic so each agent can use its own
// type guard.
export async function generateJson<T>(opts: GenerateJsonOptions): Promise<T | null> {
  const text = await chatComplete({
    model: opts.model,
    prompt: opts.prompt,
    grounded: opts.groundWithSearch,
    timeoutMs: opts.timeoutMs ?? 8000,
  })
  if (!text) return null
  // Tolerant extract: prefer the first {..} or [..] block. Models occasionally
  // wrap JSON in fences even when told not to.
  const match = text.match(/\{[\s\S]*\}/)?.[0] ?? text.match(/\[[\s\S]*\]/)?.[0] ?? null
  if (!match) return null
  try {
    return JSON.parse(match) as T
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Tool-use loop. Used by the conversational planner (F1) to let the model call
// the deterministic planner (and OneMap search) as tools. The actual loop (with
// a native impl per backend) lives in ./provider#chatCompleteWithTools; these
// are the stable types + a thin wrapper so existing callers keep importing from
// runner. Bounded by maxRounds + timeout; null on failure (graceful degrade).
// ---------------------------------------------------------------------------

export type ToolHandler = ProviderTool['handler']
export type ToolDef = ProviderTool
export type ToolCallTrace = ToolCall
export type { ToolLoopResult }

export type GenerateWithToolsOptions = {
  model: string
  prompt: string
  tools: ToolDef[]
  maxRounds?: number
  timeoutMs?: number
}

export async function generateWithTools(
  opts: GenerateWithToolsOptions
): Promise<ToolLoopResult | null> {
  return chatCompleteWithTools({
    model: opts.model,
    prompt: opts.prompt,
    tools: opts.tools,
    maxRounds: opts.maxRounds,
    timeoutMs: opts.timeoutMs,
  })
}

// Verifier verdict shape shared by every verify*() call across the app.
//   pass:        ship the row as-is
//   soft_flag:   ship the row but annotate badge_meta.verifier_flagged = true
//                and badge_meta.verifier_reason for later review
//   hard_reject: drop the row; push reason onto summary.errors
export type Verdict = {
  verdict: 'pass' | 'soft_flag' | 'hard_reject'
  confidence: number // 0..1, the model's own self-reported confidence
  reason: string
}

function isVerdict(x: unknown): x is Verdict {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    (o.verdict === 'pass' || o.verdict === 'soft_flag' || o.verdict === 'hard_reject') &&
    typeof o.confidence === 'number' &&
    typeof o.reason === 'string'
  )
}

export type VerifyOptions = {
  model: string
  prompt: string
  timeoutMs?: number
  groundWithSearch?: boolean
}

// Single-turn verifier. Returns a `pass` verdict if anything goes wrong so
// verifier outages can never wedge a cron job — the deterministic pipeline
// continues unchanged.
export async function verify(opts: VerifyOptions): Promise<Verdict> {
  const out = await generateJson<Verdict>({
    model: opts.model,
    prompt: opts.prompt,
    timeoutMs: opts.timeoutMs ?? 5000,
    groundWithSearch: opts.groundWithSearch,
  })
  if (!out || !isVerdict(out)) {
    return { verdict: 'pass', confidence: 0, reason: 'verifier unavailable' }
  }
  // Clamp + normalise.
  return {
    verdict: out.verdict,
    confidence: Math.max(0, Math.min(1, out.confidence)),
    reason: out.reason.slice(0, 240),
  }
}

// ---------------------------------------------------------------------------
// Verifier debate (F4). A proposer argues the row is grounded; a skeptic tries
// to refute it. The two opposed verdicts are combined by resolveDebate — a
// PURE, deterministic function — into the final keep/flag/drop decision. The
// LLMs only supply arguments; code decides the consequence (roadmap #2).
// ---------------------------------------------------------------------------

// Pure tie-break. No I/O — unit-testable in isolation.
//   pass         iff both sides pass
//   hard_reject  iff the skeptic confidently rejects AND the proposer isn't
//                strongly defending (so a single confident refutation only
//                drops a row the proposer can't stand behind)
//   soft_flag    otherwise — genuine disagreement/uncertainty ships the row
//                with an annotation rather than silently dropping it
export function resolveDebate(proposer: Verdict, skeptic: Verdict): Verdict {
  const strongProposerDefend = proposer.verdict === 'pass' && proposer.confidence >= 0.8
  const confidentSkepticReject =
    skeptic.verdict === 'hard_reject' && skeptic.confidence >= 0.7

  let verdict: Verdict['verdict']
  let confidence: number
  if (proposer.verdict === 'pass' && skeptic.verdict === 'pass') {
    verdict = 'pass'
    confidence = Math.min(proposer.confidence, skeptic.confidence)
  } else if (confidentSkepticReject && !strongProposerDefend) {
    verdict = 'hard_reject'
    confidence = skeptic.confidence
  } else {
    verdict = 'soft_flag'
    confidence = 0.5
  }

  const reason = `keep: ${proposer.reason || 'n/a'} | reject: ${skeptic.reason || 'n/a'}`.slice(
    0,
    240
  )
  return { verdict, confidence, reason }
}

export type DebateOptions = {
  proposerPrompt: string
  skepticPrompt: string
  model: string
  timeoutMs?: number
  // When true, both proposer + skeptic run with Google Search grounding
  // (museum + freshness verifiers need this).
  groundWithSearch?: boolean
}

// Run proposer + skeptic in parallel, then resolve deterministically. Each side
// is a verify() call, so a double-outage degrades to pass — identical to the
// single-judge graceful-degrade contract.
export async function debateVerdict(opts: DebateOptions): Promise<Verdict> {
  const [proposer, skeptic] = await Promise.all([
    verify({
      model: opts.model,
      prompt: opts.proposerPrompt,
      timeoutMs: opts.timeoutMs,
      groundWithSearch: opts.groundWithSearch,
    }),
    verify({
      model: opts.model,
      prompt: opts.skepticPrompt,
      timeoutMs: opts.timeoutMs,
      groundWithSearch: opts.groundWithSearch,
    }),
  ])
  return resolveDebate(proposer, skeptic)
}
