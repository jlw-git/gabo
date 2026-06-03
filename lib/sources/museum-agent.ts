// Museum discovery agent. Uses Gemini Flash + Google Search grounding to find
// current and upcoming exhibitions at venues whose sites are JS-rendered
// (ArtScience, NHB) or otherwise not fetch()-scrapeable (Gardens by the Bay).
//
// Runs monthly via /api/cron/sync-museums. On each run it:
//   1. Asks Gemini to search the web for current exhibitions at each venue
//   2. Upserts found exhibitions into the venues table (source: 'editorial')
//   3. Deactivates any agent-managed rows whose ends_at has passed
//
// Source_ids use the pattern <prefix>-<slug>, e.g. 'artscience-future-world'.
// Same exhibition across runs → same slug → upsert is a no-op (idempotent).
//
// Requires: GOOGLE_GEMINI_API_KEY (free at aistudio.google.com, separate from
// the Maps Platform GOOGLE_PLACES_API_KEY)

import { chatComplete } from '@/lib/agents/provider'
import { EXTRACTION_MODEL } from '@/lib/agents/models'
import { verifyMuseumExhibition } from '@/lib/agents/verifiers/museum-extraction'
import { createServiceRoleClient } from '@/lib/supabase/server'
import type { HoursJson } from '@/lib/planner/types'
import { editorialEventToVenue, type EditorialEvent } from './editorial-events'


type MuseumConfig = {
  source_prefix: string
  name: string
  search_query: string
  lat: number
  lng: number
  address: string
  budget_band: number
  hours: HoursJson | null
  cuisine_tags: string[]
  vibe_tags: string[]
}

// All venues where monthly agent-driven discovery makes more sense than a
// daily scraper. Add new entries here as needed — no other files to change.
const MUSEUMS: MuseumConfig[] = [
  {
    source_prefix: 'artscience',
    name: 'ArtScience Museum',
    search_query: 'ArtScience Museum Singapore site:marinabaysands.com exhibitions current upcoming 2026',
    lat: 1.2863,
    lng: 103.8593,
    address: 'ArtScience Museum, 6 Bayfront Ave, Singapore 018974',
    budget_band: 2,
    hours: {
      mon: [{ open: '1000', close: '2000' }],
      tue: [{ open: '1000', close: '2000' }],
      wed: [{ open: '1000', close: '2000' }],
      thu: [{ open: '1000', close: '2000' }],
      fri: [{ open: '1000', close: '2000' }],
      sat: [{ open: '1000', close: '2000' }],
      sun: [{ open: '1000', close: '2000' }],
    },
    cuisine_tags: ['experience', 'exhibition', 'art'],
    vibe_tags: ['adventurous', 'celebratory'],
  },
  {
    source_prefix: 'nhb',
    name: 'National Museum of Singapore',
    search_query: 'National Museum Singapore nhb.gov.sg exhibitions current upcoming 2026',
    lat: 1.2966,
    lng: 103.8481,
    address: 'National Museum of Singapore, 93 Stamford Rd, Singapore 178897',
    budget_band: 1,
    hours: {
      mon: [{ open: '1000', close: '1900' }],
      tue: [{ open: '1000', close: '1900' }],
      wed: [{ open: '1000', close: '1900' }],
      thu: [{ open: '1000', close: '1900' }],
      fri: [{ open: '1000', close: '1900' }],
      sat: [{ open: '1000', close: '1900' }],
      sun: [{ open: '1000', close: '1900' }],
    },
    cuisine_tags: ['experience', 'exhibition', 'history'],
    vibe_tags: ['low_key'],
  },
  {
    source_prefix: 'gtb',
    name: 'Gardens by the Bay',
    search_query: 'Gardens by the Bay Flower Dome seasonal floral display show 2026 gardensbythebay.com.sg',
    lat: 1.2839,
    lng: 103.8638,
    address: 'Gardens by the Bay, 18 Marina Gardens Dr, Singapore 018953',
    budget_band: 2,
    hours: {
      mon: [{ open: '0900', close: '2100' }],
      tue: [{ open: '0900', close: '2100' }],
      wed: [{ open: '0900', close: '2100' }],
      thu: [{ open: '0900', close: '2100' }],
      fri: [{ open: '0900', close: '2100' }],
      sat: [{ open: '0900', close: '2100' }],
      sun: [{ open: '0900', close: '2100' }],
    },
    cuisine_tags: ['experience', 'nature', 'outdoor'],
    vibe_tags: ['cozy', 'low_key'],
  },
]

const MANAGED_PREFIXES = new Set(MUSEUMS.map((m) => m.source_prefix))

// Hardcoded editorial entries from the hackathon phase that were never
// verified against real sources. Deleted on the agent's first run.
const LEGACY_STALE_IDS = [
  'artscience-marvel-2026',
  'artscience-vangogh-2026',
  'nms-once-upon-a-tide-2026',
  'gardens-flower-dome-2026',
  'esplanade-current-2026',
]

type RawExhibition = {
  name: string
  starts_at: string
  ends_at: string
  source_url: string
  photo_url?: string | null
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(s) && !isNaN(new Date(s).getTime())
}

function isRawExhibition(x: unknown): x is RawExhibition {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.name === 'string' &&
    o.name.length > 0 &&
    typeof o.starts_at === 'string' &&
    isIsoDate(o.starts_at) &&
    typeof o.ends_at === 'string' &&
    isIsoDate(o.ends_at) &&
    typeof o.source_url === 'string' &&
    o.source_url.startsWith('http') &&
    new Date(o.ends_at) > new Date()
  )
}

async function searchExhibitions(museum: MuseumConfig): Promise<RawExhibition[]> {
  const today = new Date().toISOString().slice(0, 10)

  const text = (
    await chatComplete({
      model: EXTRACTION_MODEL,
      grounded: true, // Google Search grounding — pinned to Gemini-direct
      timeoutMs: 30_000,
      prompt: `Search for current and upcoming exhibitions at ${museum.name} in Singapore.
Today is ${today}. Only include exhibitions running now or opening within the next 6 months.
Return ONLY a raw JSON array with no markdown, no explanation. Each item must have:
- name: exhibition title
- starts_at: YYYY-MM-DD
- ends_at: YYYY-MM-DD
- source_url: official page URL for this specific exhibition
- photo_url: image URL or null
Search query: ${museum.search_query}`,
    })
  ).trim()
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return []

  try {
    const parsed = JSON.parse(jsonMatch[0])
    return Array.isArray(parsed) ? parsed.filter(isRawExhibition) : []
  } catch {
    return []
  }
}

export type MuseumAgentSummary = {
  refreshed_at: string
  museums_checked: number
  exhibitions_found: number
  // Verifier outcomes. `verified` + `soft_flagged` are upserted; `hard_rejected`
  // is dropped. soft_flagged rows carry verifier_flagged=true in badge_meta.
  verified: number
  soft_flagged: number
  hard_rejected: number
  already_in_catalog: number
  upserted: number
  deactivated: number
  errors: string[]
}

export async function runMuseumAgent(): Promise<MuseumAgentSummary> {
  const summary: MuseumAgentSummary = {
    refreshed_at: new Date().toISOString(),
    museums_checked: 0,
    exhibitions_found: 0,
    verified: 0,
    soft_flagged: 0,
    hard_rejected: 0,
    already_in_catalog: 0,
    upserted: 0,
    deactivated: 0,
    errors: [],
  }

  const supabase = createServiceRoleClient()

  // Step 0: Delete legacy hackathon-era editorial rows that were never
  // verified against real sources. Safe to re-run (no-op if already gone).
  await supabase
    .from('venues')
    .delete()
    .eq('source', 'editorial')
    .in('source_id', LEGACY_STALE_IDS)

  // Step 1: Deactivate any agent-managed rows whose ends_at has passed.
  const { data: agentRows } = await supabase
    .from('venues')
    .select('source_id, badge_meta, active')
    .eq('source', 'editorial')

  const now = new Date()
  const expiredIds = (agentRows ?? [])
    .filter((row) => {
      const prefix = row.source_id.split('-')[0]
      if (!MANAGED_PREFIXES.has(prefix)) return false
      const endsAt = (row.badge_meta as { ends_at?: string } | null)?.ends_at
      if (!endsAt || !isIsoDate(endsAt)) return false
      return new Date(endsAt) < now
    })
    .map((row: { source_id: string }) => row.source_id)

  if (expiredIds.length > 0) {
    const { error } = await supabase
      .from('venues')
      .update({ active: false })
      .eq('source', 'editorial')
      .in('source_id', expiredIds)

    if (error) {
      summary.errors.push(`deactivate: ${error.message}`)
    } else {
      summary.deactivated = expiredIds.length
    }
  }

  // Step 2: Discover exhibitions for each museum.
  const allEvents: EditorialEvent[] = []
  // Track verifier verdicts so we can stamp badge_meta after the
  // EditorialEvent → venue row conversion (editorialEventToVenue builds
  // badge_meta itself; we layer verifier annotation on top).
  const softFlagsBySourceId = new Map<string, string>()

  for (const museum of MUSEUMS) {
    summary.museums_checked++
    try {
      const exhibitions = await searchExhibitions(museum)
      summary.exhibitions_found += exhibitions.length

      for (const ex of exhibitions) {
        const verdict = await verifyMuseumExhibition({
          museumName: museum.name,
          exhibition: ex,
        }).catch(() => ({ verdict: 'pass' as const, confidence: 0, reason: 'verifier error' }))

        if (verdict.verdict === 'hard_reject') {
          summary.hard_rejected++
          summary.errors.push(
            `${museum.name} "${ex.name}": verifier hard-rejected — ${verdict.reason}`
          )
          continue
        }

        const sourceId = `${museum.source_prefix}-${slugify(ex.name)}`
        if (verdict.verdict === 'soft_flag') {
          summary.soft_flagged++
          softFlagsBySourceId.set(sourceId, verdict.reason)
        } else {
          summary.verified++
        }

        allEvents.push({
          source_id: sourceId,
          source_url: ex.source_url,
          name: ex.name,
          address: museum.address,
          lat: museum.lat,
          lng: museum.lng,
          starts_at: ex.starts_at,
          ends_at: ex.ends_at,
          cuisine_tags: museum.cuisine_tags,
          vibe_tags: museum.vibe_tags,
          photo_url: ex.photo_url ?? null,
          budget_band: museum.budget_band,
          hours: museum.hours,
        })
      }
    } catch (err) {
      summary.errors.push(
        `${museum.name}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  if (allEvents.length === 0) return summary

  // Step 3: Report how many are already in the catalog.
  const candidateIds = allEvents.map((e) => e.source_id)
  const { data: existing } = await supabase
    .from('venues')
    .select('source_id')
    .eq('source', 'editorial')
    .in('source_id', candidateIds)

  summary.already_in_catalog = (existing ?? []).length

  // Step 4: Upsert all found exhibitions. After the canonical event→venue
  // conversion, stamp verifier_flagged into badge_meta for any row that the
  // verifier flagged but didn't hard-reject. The PlanCard / UI doesn't
  // surface this yet — it's persisted for cron reporting and future filtering.
  const venues = allEvents.map((e) => {
    const venue = editorialEventToVenue(e)
    const reason = softFlagsBySourceId.get(e.source_id)
    if (reason) {
      venue.badge_meta = {
        ...(venue.badge_meta as Record<string, unknown>),
        verifier_flagged: true,
        verifier_reason: reason,
      }
    }
    return venue
  })
  const chunkSize = 20
  for (let i = 0; i < venues.length; i += chunkSize) {
    const chunk = venues.slice(i, i + chunkSize)
    const { error, count } = await supabase
      .from('venues')
      .upsert(chunk, { onConflict: 'source,source_id', count: 'exact' })

    if (error) {
      summary.errors.push(`upsert chunk ${i}: ${error.message}`)
    } else {
      summary.upserted += count ?? chunk.length
    }
  }

  return summary
}
