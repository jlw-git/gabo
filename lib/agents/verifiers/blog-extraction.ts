// Blog-extraction verifier. Runs between the Gemini extractor in
// lib/sources/blog-scanner.ts and the OneMap address resolution step.
//
// Why: the extractor occasionally hallucinates — invents a venue name that
// sounds plausible for the blog's style but isn't actually in the article,
// fabricates an address by extrapolating from the neighbourhood, or assigns
// an opens_at date that doesn't appear in the source text. These slip past
// the regex/JSON-shape guards already in the extractor.
//
// This verifier asks flash-lite, with the original article text as context,
// whether the extracted row is grounded. The two-tier verdict shape is the
// same across every verifier in the app (see lib/agents/runner.ts) — hard
// rejects are dropped, soft flags are upserted with annotation.

import { VERIFIER_MODEL } from '@/lib/agents/models'
import { debateVerdict, verify, type Verdict } from '@/lib/agents/runner'

export type BlogVerifierInput = {
  // The article the extractor read. Truncated to a few thousand chars by
  // the scanner; we keep that cap to keep the verifier prompt cheap.
  articleText: string
  // The extracted row to vet — typed loosely so this verifier can run on
  // both dining (ExtractedVenue) and experience (ExtractedExperience) shapes
  // without coupling.
  venue: {
    name: string
    address: string
    opens_at?: string | null
    ends_at?: string | null
    starts_at?: string | null
  }
}

// Shared evidence block both the single-judge prompt and the debate roles see.
function evidence(input: BlogVerifierInput): string {
  const { venue, articleText } = input
  const dates = [
    venue.opens_at ? `opens_at=${venue.opens_at}` : null,
    venue.starts_at ? `starts_at=${venue.starts_at}` : null,
    venue.ends_at ? `ends_at=${venue.ends_at}` : null,
  ]
    .filter(Boolean)
    .join(', ')
  return `Article text:
${articleText.slice(0, 4000)}

Extracted venue:
- name: ${venue.name}
- address: ${venue.address}
${dates ? `- dates: ${dates}` : ''}`
}

const VERDICT_JSON =
  'Return ONLY raw JSON, no markdown:\n{ "verdict": "pass" | "soft_flag" | "hard_reject", "confidence": <0..1>, "reason": "<≤200 chars>" }'

// Neutral single-judge prompt (used when the debate flag is off).
function judgePrompt(input: BlogVerifierInput): string {
  return `You are verifying that a venue extracted from a Singapore food/lifestyle blog article is grounded in the article text. Hallucinations are common: invented names, fabricated addresses, dates that don't actually appear.

${evidence(input)}

Decide a verdict:
- "pass": the venue name is clearly present in the article (verbatim or trivial casing), the address is consistent with what the article says, and any extracted dates appear in the text.
- "soft_flag": the venue is plausibly present but one detail is uncertain — e.g. address is approximate, a date isn't explicit in the text but is consistent with publishing context, or the name appears in a paraphrased form. Set confidence between 0.4 and 0.7.
- "hard_reject": the venue name does NOT appear in the article in any recognisable form, OR the address is for the wrong country/city, OR the extracted dates contradict what the article says. Set confidence ≥ 0.8 only when you're sure.

${VERDICT_JSON}`
}

// Debate roles — same evidence, opposed stances.
function proposerPrompt(input: BlogVerifierInput): string {
  return `You are DEFENDING a venue extracted from a Singapore food/lifestyle blog article. Argue — fairly but honestly — that it IS grounded in the article text.

${evidence(input)}

- "pass": the name is present (verbatim, trivial casing, or a clear paraphrase) and the details are consistent with the article.
- "soft_flag": you can defend it but one detail is shaky (approximate address, a date that's implied rather than stated).
- "hard_reject": only if, defending in good faith, you genuinely cannot find the venue in the article.

${VERDICT_JSON}`
}

function skepticPrompt(input: BlogVerifierInput): string {
  return `You are a SKEPTIC trying to REFUTE a venue extracted from a Singapore food/lifestyle blog article. Extractors hallucinate: invented names, addresses extrapolated from the neighbourhood, dates that never appear. Hunt for any sign this row is ungrounded.

${evidence(input)}

- "hard_reject" (confidence ≥ 0.8): the name does NOT appear in any recognisable form, OR the address is the wrong city/country, OR the dates contradict the text.
- "soft_flag": suspicious — a detail looks extrapolated — but you can't prove it's wrong.
- "pass": only if you genuinely cannot refute it.
Default to hard_reject when uncertain.

${VERDICT_JSON}`
}

export async function verifyBlogExtraction(
  input: BlogVerifierInput,
  // Explicit override for the debug route; defaults to the env flag so the
  // scanner picks up the mode without passing anything.
  opts?: { debate?: boolean }
): Promise<Verdict> {
  const debate = opts?.debate ?? process.env.AGENTIC_VERIFIER_DEBATE === 'true'
  // Debate mode (F4): proposer + skeptic + deterministic tie-break. Gated so
  // the single-judge path stays the default until measured. Doubles the
  // verifier LLM calls per row when on.
  if (debate) {
    return debateVerdict({
      proposerPrompt: proposerPrompt(input),
      skepticPrompt: skepticPrompt(input),
      model: VERIFIER_MODEL,
      timeoutMs: 5000,
    })
  }

  return verify({
    model: VERIFIER_MODEL,
    prompt: judgePrompt(input),
    timeoutMs: 5000,
  })
}
