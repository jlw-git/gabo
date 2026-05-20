// Events catalog sync. Combines four real sources:
//   1. Museum scrapers — SAM + NGS exhibitions (live HTML scraping)
//   2. Esplanade      — in-house programming (sitemap + JSON-LD parse)
//   3. The Smart Local — date-bounded events extracted via Gemini Flash
//   4. Editorial      — hand-curated picks: ArtScience, Gardens, NHB
//
// Bandsintown was removed: its Data Applications Terms restrict API access
// to artists/representatives and forbid third-party aggregation, so a
// consumer date planner can't use it without written approval.
//
// Each source is independently try/caught — one failure doesn't poison the rest.
// Run via /api/cron/sync-events (daily) or manually.

import { createServiceRoleClient } from '@/lib/supabase/server'
import { EDITORIAL_EVENTS, editorialEventToVenue } from './editorial-events'
import { fetchEsplanadeEvents } from './esplanade'
import {
  fetchNgsExhibitions,
  fetchSamExhibitions,
  museumEventToVenue,
} from './museum-scrapers'
import { fetchTslEvents, tslEventToVenue } from './tsl-events'

export type EventsSyncSummary = {
  refreshed_at: string
  sam_events: number
  sam_error: string | null
  ngs_events: number
  ngs_error: string | null
  esplanade_events: number
  esplanade_error: string | null
  tsl_events: number
  tsl_error: string | null
  editorial_events: number
  upserted: number
  errors: string[]
}

export async function syncEventsCatalog(): Promise<EventsSyncSummary> {
  const summary: EventsSyncSummary = {
    refreshed_at: new Date().toISOString(),
    sam_events: 0,
    sam_error: null,
    ngs_events: 0,
    ngs_error: null,
    esplanade_events: 0,
    esplanade_error: null,
    tsl_events: 0,
    tsl_error: null,
    editorial_events: 0,
    upserted: 0,
    errors: [],
  }

  type AnyRow =
    | ReturnType<typeof editorialEventToVenue>
    | ReturnType<typeof museumEventToVenue>
    | ReturnType<typeof tslEventToVenue>

  const collected: AnyRow[] = []

  // 1) SAM exhibitions.
  try {
    const events = await fetchSamExhibitions()
    summary.sam_events = events.length
    for (const e of events) collected.push(museumEventToVenue(e))
  } catch (err) {
    summary.sam_error = err instanceof Error ? err.message : 'unknown'
  }

  // 2) NGS exhibitions.
  try {
    const events = await fetchNgsExhibitions()
    summary.ngs_events = events.length
    for (const e of events) collected.push(museumEventToVenue(e))
  } catch (err) {
    summary.ngs_error = err instanceof Error ? err.message : 'unknown'
  }

  // 3) Esplanade in-house programming.
  try {
    const events = await fetchEsplanadeEvents()
    summary.esplanade_events = events.length
    for (const e of events) collected.push(editorialEventToVenue(e))
  } catch (err) {
    summary.esplanade_error = err instanceof Error ? err.message : 'unknown'
  }

  // 4) The Smart Local — Gemini-extracted date-bounded events.
  try {
    const events = await fetchTslEvents()
    summary.tsl_events = events.length
    for (const e of events) collected.push(tslEventToVenue(e))
  } catch (err) {
    summary.tsl_error = err instanceof Error ? err.message : 'unknown'
  }

  // 5) Editorial events — always present, no API dependency.
  for (const e of EDITORIAL_EVENTS) {
    collected.push(editorialEventToVenue(e))
    summary.editorial_events += 1
  }

  // 6) Dedup by source:source_id. Editorial wins ties (appended last).
  const byKey = new Map<string, AnyRow>()
  for (const row of collected) {
    byKey.set(`${row.source}:${row.source_id}`, row)
  }
  const deduped = [...byKey.values()]

  // 7) Upsert to Supabase. Service role bypasses RLS — sync routes are
  // already protected by CRON_SECRET.
  const supabase = createServiceRoleClient()
  const chunkSize = 50
  for (let i = 0; i < deduped.length; i += chunkSize) {
    const chunk = deduped.slice(i, i + chunkSize)
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
