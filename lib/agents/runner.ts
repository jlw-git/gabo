// Shared Gemini call helpers used by every agent in the app.
//
// Wraps @google/genai with two small primitives:
//   - generateJson(): single-turn structured-output call with a [..] / {..}
//     tolerant parser and a hard timeout
//   - verify(): one-shot LLM-as-judge that returns a stable verdict shape
//     used by every verifier (blog extraction, museum exhibitions, freshness)
//
// Tool-use loops (function-calling) belong in their own agent module — keep
// this file boring on purpose. The agents that need tools build their own
// loop over generateContent with config.tools.

import { GoogleGenAI, type Content, type FunctionCall, type Part } from '@google/genai'

function client(): GoogleGenAI {
  const key = process.env.GOOGLE_GEMINI_API_KEY
  if (!key) throw new Error('GOOGLE_GEMINI_API_KEY missing')
  return new GoogleGenAI({ apiKey: key })
}

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
  const timeoutMs = opts.timeoutMs ?? 8000
  const ai = client()

  const call = (async (): Promise<T | null> => {
    try {
      const result = await ai.models.generateContent({
        model: opts.model,
        contents: opts.prompt,
        config: opts.groundWithSearch
          ? { tools: [{ googleSearch: {} }] }
          : undefined,
      })
      const text = (result.text ?? '').trim()
      if (!text) return null
      // Tolerant extract: prefer the first {..} or [..] block. Gemini
      // occasionally wraps JSON in fences even when told not to.
      const match =
        text.match(/\{[\s\S]*\}/)?.[0] ?? text.match(/\[[\s\S]*\]/)?.[0] ?? null
      if (!match) return null
      try {
        return JSON.parse(match) as T
      } catch {
        return null
      }
    } catch {
      return null
    }
  })()

  return Promise.race([
    call,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ])
}

// ---------------------------------------------------------------------------
// Tool-use loop. Used by the conversational planner (F1) to let the model call
// the deterministic planner (and OneMap place search) as tools. Kept generic:
// callers declare tools with JSON-Schema params + a JS handler, and the loop
// drives generateContent until the model returns text. Bounded by maxRounds +
// a hard timeout; returns null on any failure so callers degrade gracefully —
// same contract as generateJson().
// ---------------------------------------------------------------------------

export type ToolHandler = (
  args: Record<string, unknown>
) => Promise<Record<string, unknown>>

export type ToolDef = {
  name: string
  description: string
  // JSON Schema for the function args (passed via parametersJsonSchema).
  parameters: Record<string, unknown>
  handler: ToolHandler
}

export type ToolCallTrace = { name: string; args: Record<string, unknown> }

export type ToolLoopResult = {
  text: string
  toolCalls: ToolCallTrace[]
}

export type GenerateWithToolsOptions = {
  model: string
  prompt: string
  tools: ToolDef[]
  // Max model<->tool round-trips before we force a final text turn. Default 3.
  maxRounds?: number
  // Wall-clock budget across the whole loop. Default 12s.
  timeoutMs?: number
}

export async function generateWithTools(
  opts: GenerateWithToolsOptions
): Promise<ToolLoopResult | null> {
  const timeoutMs = opts.timeoutMs ?? 12_000
  const maxRounds = opts.maxRounds ?? 3
  const ai = client()

  const byName = new Map(opts.tools.map((t) => [t.name, t]))
  const functionDeclarations = opts.tools.map((t) => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: t.parameters,
  }))

  const run = (async (): Promise<ToolLoopResult | null> => {
    const contents: Content[] = [{ role: 'user', parts: [{ text: opts.prompt }] }]
    const toolCalls: ToolCallTrace[] = []

    try {
      for (let round = 0; round < maxRounds; round++) {
        const result = await ai.models.generateContent({
          model: opts.model,
          contents,
          config: { tools: [{ functionDeclarations }] },
        })

        const calls: FunctionCall[] = result.functionCalls ?? []
        if (calls.length === 0) {
          return { text: (result.text ?? '').trim(), toolCalls }
        }

        // Echo the model's function-call turn back into the transcript, then
        // append one functionResponse per call so the next turn sees results.
        contents.push({ role: 'model', parts: calls.map((c) => ({ functionCall: c })) })
        const responseParts: Part[] = []
        for (const call of calls) {
          const name = call.name ?? ''
          const args = (call.args ?? {}) as Record<string, unknown>
          toolCalls.push({ name, args })
          const tool = byName.get(name)
          let response: Record<string, unknown>
          if (!tool) {
            response = { error: `unknown tool: ${name}` }
          } else {
            try {
              response = await tool.handler(args)
            } catch (err) {
              response = { error: err instanceof Error ? err.message : 'tool failed' }
            }
          }
          responseParts.push({ functionResponse: { name, response } })
        }
        contents.push({ role: 'user', parts: responseParts })
      }

      // Rounds exhausted while the model still wanted tools: take one final
      // turn with no tools to force a closing text message.
      const final = await ai.models.generateContent({ model: opts.model, contents })
      return { text: (final.text ?? '').trim(), toolCalls }
    } catch {
      return null
    }
  })()

  return Promise.race([
    run,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ])
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
}

// Run proposer + skeptic in parallel, then resolve deterministically. Each side
// is a verify() call, so a double-outage degrades to pass — identical to the
// single-judge graceful-degrade contract.
export async function debateVerdict(opts: DebateOptions): Promise<Verdict> {
  const [proposer, skeptic] = await Promise.all([
    verify({ model: opts.model, prompt: opts.proposerPrompt, timeoutMs: opts.timeoutMs }),
    verify({ model: opts.model, prompt: opts.skepticPrompt, timeoutMs: opts.timeoutMs }),
  ])
  return resolveDebate(proposer, skeptic)
}
