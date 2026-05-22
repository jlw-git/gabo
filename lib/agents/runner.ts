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

import { GoogleGenAI } from '@google/genai'

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
