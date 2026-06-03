// Museum-exhibition verifier. Runs between searchExhibitions() (Gemini
// flash + Google Search grounding) and the upsert in museum-agent.ts.
//
// Why this is different from blog verification: museum exhibitions are
// extracted from Gemini's *interpretation* of search results, not from
// pasted article text. The most common failure mode is Gemini citing an
// outdated source_url (last year's exhibition page surfaces in search) or
// fabricating an exhibition name that combines two real ones. The fix is
// to fetch the source_url and ask flash-lite to confirm the exhibition
// name + dates actually appear on the page.

import * as cheerio from 'cheerio'
import { VERIFIER_MODEL } from '@/lib/agents/models'
import { debateVerdict, verify, type Verdict } from '@/lib/agents/runner'

export type MuseumVerifierInput = {
  museumName: string
  exhibition: {
    name: string
    starts_at: string
    ends_at: string
    source_url: string
  }
}

// Pull readable text out of the source page. Same allowlist of content
// selectors as blog-scanner uses — keep this dependency-light. Returns
// empty string on any fetch error so the verifier can pass-through.
async function fetchPageText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Gabo/1.0)' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return ''
    const html = await res.text()
    const $ = cheerio.load(html)
    $('script, style, nav, footer, aside').remove()
    const body =
      $('main').text() ||
      $('article').text() ||
      $('.entry-content, .post-content, .content').text() ||
      $('body').text()
    return body.replace(/\s+/g, ' ').trim().slice(0, 4000)
  } catch {
    return ''
  }
}

const VERDICT_JSON =
  'Return ONLY raw JSON:\n{ "verdict": "pass" | "soft_flag" | "hard_reject", "confidence": <0..1>, "reason": "<≤200 chars>" }'

function exhibitionLines(ex: MuseumVerifierInput['exhibition']): string {
  return `- name: ${ex.name}\n- runs: ${ex.starts_at} to ${ex.ends_at}\n- source URL: ${ex.source_url}`
}

// --- Search-grounded path (no page text) ---
function searchJudge(i: MuseumVerifierInput): string {
  return `You are verifying that an exhibition extracted from search results actually exists at ${i.museumName} in Singapore. Search the web to confirm.

Extracted exhibition:
${exhibitionLines(i.exhibition)}

Decide:
- "pass": clear confirmation this exhibition exists at this museum with roughly these dates.
- "soft_flag": partial confirmation but dates or framing are uncertain.
- "hard_reject": no evidence this exhibition exists, OR it's at a different museum, OR the dates are demonstrably wrong.

${VERDICT_JSON}`
}
function searchProposer(i: MuseumVerifierInput): string {
  return `You are DEFENDING that this exhibition is real and current at ${i.museumName} in Singapore. Search the web for confirmation — the museum's listing, press, event sites.

Extracted exhibition:
${exhibitionLines(i.exhibition)}

- "pass": you find confirmation it exists with roughly these dates.
- "soft_flag": some confirmation but dates/framing uncertain.
- "hard_reject": only if, searching in good faith, you find no evidence at all.

${VERDICT_JSON}`
}
function searchSkeptic(i: MuseumVerifierInput): string {
  return `You are a SKEPTIC. The exhibition below was inferred from search results and may be fabricated, outdated (last year's show), or at the wrong museum. Search for disconfirming evidence.

Extracted exhibition:
${exhibitionLines(i.exhibition)}

- "hard_reject" (confidence ≥ 0.8): no evidence it exists, OR it's a past/ended show, OR a different museum, OR the dates contradict reality.
- "soft_flag": suspicious — thin or stale evidence.
- "pass": only if you clearly confirm it's current at ${i.museumName}.
Default to hard_reject when you cannot confirm it's a current exhibition.

${VERDICT_JSON}`
}

// --- Page-text path (the source page was fetched) ---
function pageEvidence(i: MuseumVerifierInput, pageText: string): string {
  return `Museum: ${i.museumName}
Source URL: ${i.exhibition.source_url}

Page text (truncated):
${pageText}

Extracted exhibition:
- name: ${i.exhibition.name}
- starts_at: ${i.exhibition.starts_at}
- ends_at: ${i.exhibition.ends_at}`
}
function pageJudge(i: MuseumVerifierInput, pageText: string): string {
  return `You are verifying that an exhibition extracted from search results matches the museum's official page.

${pageEvidence(i, pageText)}

Decide:
- "pass": the exhibition name appears on the page (verbatim or trivial casing) and the dates are within a few days of what the page states.
- "soft_flag": the name appears in some form but dates are uncertain/partial, OR the name is paraphrased. Confidence 0.4–0.7.
- "hard_reject": the name does NOT appear on the page (old/unrelated URL), OR the dates clearly contradict the page. Confidence ≥ 0.8.

${VERDICT_JSON}`
}
function pageProposer(i: MuseumVerifierInput, pageText: string): string {
  return `You are DEFENDING that the extracted exhibition matches this museum page. Find the name + dates on the page.

${pageEvidence(i, pageText)}

- "pass": the name is on the page (verbatim/trivial casing) and dates roughly match.
- "soft_flag": present but a detail (dates/wording) is shaky.
- "hard_reject": only if the name genuinely does not appear on the page.

${VERDICT_JSON}`
}
function pageSkeptic(i: MuseumVerifierInput, pageText: string): string {
  return `You are a SKEPTIC. Check whether the extracted exhibition is actually on this page — Gemini often surfaces an OLD or UNRELATED URL.

${pageEvidence(i, pageText)}

- "hard_reject" (confidence ≥ 0.8): the name does NOT appear on the page, OR the dates clearly contradict it.
- "soft_flag": the name is only loosely/partially present, or dates are off.
- "pass": only if the name clearly appears and dates match.
Default to hard_reject when the page doesn't actually show this exhibition.

${VERDICT_JSON}`
}

export async function verifyMuseumExhibition(input: MuseumVerifierInput): Promise<Verdict> {
  const debate = process.env.AGENTIC_VERIFIER_DEBATE === 'true'
  const pageText = await fetchPageText(input.exhibition.source_url)

  // Page fetch failed → search-grounded check (riskier; both roles run grounded).
  if (!pageText) {
    if (debate) {
      return debateVerdict({
        proposerPrompt: searchProposer(input),
        skepticPrompt: searchSkeptic(input),
        model: VERIFIER_MODEL,
        timeoutMs: 25_000,
        groundWithSearch: true,
      })
    }
    return verify({ model: VERIFIER_MODEL, prompt: searchJudge(input), timeoutMs: 25_000, groundWithSearch: true })
  }

  // Page-text path (no grounding needed — the page is the evidence).
  if (debate) {
    return debateVerdict({
      proposerPrompt: pageProposer(input, pageText),
      skepticPrompt: pageSkeptic(input, pageText),
      model: VERIFIER_MODEL,
      timeoutMs: 5000,
    })
  }
  return verify({ model: VERIFIER_MODEL, prompt: pageJudge(input, pageText), timeoutMs: 5000 })
}
