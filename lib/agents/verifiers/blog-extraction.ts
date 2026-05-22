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
import { verify, type Verdict } from '@/lib/agents/runner'

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

export async function verifyBlogExtraction(input: BlogVerifierInput): Promise<Verdict> {
  const { venue, articleText } = input
  const dates = [
    venue.opens_at ? `opens_at=${venue.opens_at}` : null,
    venue.starts_at ? `starts_at=${venue.starts_at}` : null,
    venue.ends_at ? `ends_at=${venue.ends_at}` : null,
  ]
    .filter(Boolean)
    .join(', ')

  const prompt = `You are verifying that a venue extracted from a Singapore food/lifestyle blog article is grounded in the article text. Hallucinations are common: invented names, fabricated addresses, dates that don't actually appear.

Article text:
${articleText.slice(0, 4000)}

Extracted venue:
- name: ${venue.name}
- address: ${venue.address}
${dates ? `- dates: ${dates}` : ''}

Decide a verdict:
- "pass": the venue name is clearly present in the article (verbatim or trivial casing), the address is consistent with what the article says, and any extracted dates appear in the text.
- "soft_flag": the venue is plausibly present but one detail is uncertain — e.g. address is approximate, a date isn't explicit in the text but is consistent with publishing context, or the name appears in a paraphrased form. Set confidence between 0.4 and 0.7.
- "hard_reject": the venue name does NOT appear in the article in any recognisable form, OR the address is for the wrong country/city, OR the extracted dates contradict what the article says. Set confidence ≥ 0.8 only when you're sure.

Return ONLY raw JSON, no markdown:
{ "verdict": "pass" | "soft_flag" | "hard_reject", "confidence": <0..1>, "reason": "<≤200 chars>" }`

  return verify({
    model: VERIFIER_MODEL,
    prompt,
    timeoutMs: 5000,
  })
}
