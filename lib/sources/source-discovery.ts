// Autonomous source discovery (F4). A grounded agent that proposes NEW Singapore
// food/lifestyle editorial sources the blog scanner could add — but only
// PROPOSES: candidates are deterministically de-duped against the sources we
// already scan and checked for reachability, then recorded for human review.
// It never auto-adds anything to the scan list (avoids junk ingestion).
//
// Guardrail (#2): the LLM only suggests; code decides what's novel + reachable.

import { EXTRACTION_MODEL } from '@/lib/agents/models'
import { chatComplete } from '@/lib/agents/provider'

// Hostnames we already scan (keep in sync with blog-scanner's BLOGS + eatbook).
const KNOWN_HOSTS = new Set([
  'sethlui.com',
  'danielfooddiary.com',
  'misstamchiak.com',
  'ladyironchef.com',
  'thesmartlocal.com',
  'eatbook.sg',
])

export type SourceCandidate = {
  name: string
  url: string
  kind: 'dining' | 'experience'
  suggested_mode: 'rss' | 'html' | 'sitemap'
  feed_url?: string
  reason: string
}

export type DiscoverySummary = {
  ran_at: string
  raw: number // how many the model proposed
  skipped_known: number // already in our source list
  unreachable: number // failed the reachability check
  proposed: SourceCandidate[] // novel + reachable, for review
}

function hostname(u: string): string | null {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Gabo/1.0)' },
      signal: AbortSignal.timeout(8_000),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function discoverSources(): Promise<DiscoverySummary> {
  const summary: DiscoverySummary = {
    ran_at: new Date().toISOString(),
    raw: 0,
    skipped_known: 0,
    unreachable: 0,
    proposed: [],
  }

  const known = [...KNOWN_HOSTS].join(', ')
  const prompt = `You are finding NEW Singapore food & lifestyle editorial sources (blogs / sites) that regularly publish about new restaurants, cafes, bars, pop-ups, exhibitions, and things to do — the kind a date-night planner could scan weekly for fresh venues. We ALREADY use these (do NOT suggest them): ${known}.

Search the web to confirm each suggestion is a real, currently-active Singapore source publishing recent content. Suggest up to 8 DIFFERENT ones.

Return ONLY a raw JSON array, each item:
{ "name": "Site name", "url": "https://site.com", "kind": "dining" | "experience", "suggested_mode": "rss" | "html" | "sitemap", "feed_url": "https://site.com/feed/ or null", "reason": "one short line on why it fits" }`

  const text = await chatComplete({
    model: EXTRACTION_MODEL,
    grounded: true,
    timeoutMs: 60_000, // grounded web search is slow + variable
    prompt,
  })

  const match = text.match(/\[[\s\S]*\]/)
  let raw: unknown[] = []
  if (match) {
    try {
      const parsed = JSON.parse(match[0])
      if (Array.isArray(parsed)) raw = parsed
    } catch {
      /* unparseable — leave empty */
    }
  }
  summary.raw = raw.length

  const seen = new Set<string>()
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const url = typeof o.url === 'string' ? o.url : ''
    const name = typeof o.name === 'string' ? o.name : ''
    const h = url ? hostname(url) : null
    if (!url || !name || !h) continue
    if (KNOWN_HOSTS.has(h)) {
      summary.skipped_known++
      continue
    }
    if (seen.has(h)) continue
    seen.add(h)
    if (!(await reachable(url))) {
      summary.unreachable++
      continue
    }
    const mode = o.suggested_mode
    summary.proposed.push({
      name,
      url,
      kind: o.kind === 'experience' ? 'experience' : 'dining',
      suggested_mode: mode === 'rss' || mode === 'html' || mode === 'sitemap' ? mode : 'html',
      feed_url: typeof o.feed_url === 'string' && o.feed_url.startsWith('http') ? o.feed_url : undefined,
      reason: typeof o.reason === 'string' ? o.reason.slice(0, 200) : '',
    })
  }

  return summary
}
