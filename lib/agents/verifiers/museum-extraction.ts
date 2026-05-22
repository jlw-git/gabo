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
import { verify, type Verdict } from '@/lib/agents/runner'

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

export async function verifyMuseumExhibition(input: MuseumVerifierInput): Promise<Verdict> {
  const { exhibition, museumName } = input
  const pageText = await fetchPageText(exhibition.source_url)

  // If we couldn't even fetch the page, defer to a search-grounded check.
  // The verifier runs without page context — riskier, so we tilt toward
  // soft_flag rather than hard_reject when uncertain.
  if (!pageText) {
    const prompt = `You are verifying that an exhibition extracted from search results actually exists at ${museumName} in Singapore. Search the web to confirm.

Extracted exhibition:
- name: ${exhibition.name}
- runs: ${exhibition.starts_at} to ${exhibition.ends_at}
- source URL: ${exhibition.source_url}

Decide:
- "pass": you find clear confirmation this exhibition exists at this museum with roughly these dates.
- "soft_flag": you find partial confirmation but dates or framing are uncertain.
- "hard_reject": you find no evidence this exhibition exists, OR it's at a different museum, OR the dates are demonstrably wrong.

Return ONLY raw JSON:
{ "verdict": "pass" | "soft_flag" | "hard_reject", "confidence": <0..1>, "reason": "<≤200 chars>" }`
    return verify({
      model: VERIFIER_MODEL,
      prompt,
      timeoutMs: 8000,
      groundWithSearch: true,
    })
  }

  const prompt = `You are verifying that an exhibition extracted from search results matches the museum's official page.

Museum: ${museumName}
Source URL: ${exhibition.source_url}

Page text (truncated):
${pageText}

Extracted exhibition:
- name: ${exhibition.name}
- starts_at: ${exhibition.starts_at}
- ends_at: ${exhibition.ends_at}

Decide:
- "pass": the exhibition name appears on the page (verbatim or trivial casing) and the dates are within a few days of what the page states.
- "soft_flag": the name appears in some form but dates are uncertain or only partially visible, OR the name is paraphrased rather than verbatim. Confidence 0.4–0.7.
- "hard_reject": the exhibition name does NOT appear on the page (Gemini surfaced an old or unrelated URL), OR the dates clearly contradict what the page states. Confidence ≥ 0.8.

Return ONLY raw JSON:
{ "verdict": "pass" | "soft_flag" | "hard_reject", "confidence": <0..1>, "reason": "<≤200 chars>" }`

  return verify({
    model: VERIFIER_MODEL,
    prompt,
    timeoutMs: 5000,
  })
}
