// Events catalog sync. Combines three real sources:
//   1. Bandsintown    — SG concerts (free API, real ticket links)
//   2. Museum scrapers — SAM + NGS exhibitions (live HTML scraping)
//   3. Editorial      — hand-curated picks: ArtScience, Gardens, Esplanade, NHB
//
// Each source is independently try/caught — one failure doesn't poison the rest.
// Run via /api/cron/sync-events (daily) or manually.

import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  BandsintownAuthError,
  bandsintownEventToVenue,
  fetchSingaporeConcerts,
} from './bandsintown'
import { EDITORIAL_EVENTS, editorialEventToVenue } from './editorial-events'
import {
  fetchNgsExhibitions,
  fetchSamExhibitions,
  museumEventToVenue,
} from './museum-scrapers'

export type EventsSyncSummary = {
  refreshed_at: string
  bandsintown_events: number
  bandsintown_error: string | null
  sam_events: number
  sam_error: string | null
  ngs_events: number
  ngs_error: string | null
  editorial_events: number
  upserted: number
  errors: string[]
}

export async function syncEventsCatalog(): Promise<EventsSyncSummary> {
  const summary: EventsSyncSummary = {
    refreshed_at: new Date().toISOString(),
    bandsintown_events: 0,
    bandsintown_error: null,
    sam_events: 0,
    sam_error: null,
    ngs_events: 0,
    ngs_error: null,
    editorial_events: 0,
    upserted: 0,
    errors: [],
  }

  type AnyRow =
    | ReturnType<typeof bandsintownEventToVenue>
    | ReturnType<typeof editorialEventToVenue>
    | ReturnType<typeof museumEventToVenue>

  const collected: AnyRow[] = []

  // 1) Bandsintown concerts.
  try {
    const events = await fetchSingaporeConcerts()
    summary.bandsintown_events = events.length
    for (const e of events) collected.push(bandsintownEventToVenue(e))
  } catch (err) {
    summary.bandsintown_error =
      err instanceof BandsintownAuthError
        ? 'BANDSINTOWN_APP_ID not set'
        : err instanceof Error
          ? err.message
          : 'unknown'
  }

  // 2) SAM exhibitions.
  try {
    const events = await fetchSamExhibitions()
    summary.sam_events = events.length
    for (const e of events) collected.push(museumEventToVenue(e))
  } catch (err) {
    summary.sam_error = err instanceof Error ? err.message : 'unknown'
  }

  // 3) NGS exhibitions.
  try {
    const events = await fetchNgsExhibitions()
    summary.ngs_events = events.length
    for (const e of events) collected.push(museumEventToVenue(e))
  } catch (err) {
    summary.ngs_error = err instanceof Error ? err.message : 'unknown'
  }

  // 4) Editorial events — always present, no API dependency.
  for (const e of EDITORIAL_EVENTS) {
    collected.push(editorialEventToVenue(e))
    summary.editorial_events += 1
  }

  // 5) Dedup by source:source_id. Editorial wins ties (appended last).
  const byKey = new Map<string, AnyRow>()
  for (const row of collected) {
    byKey.set(`${row.source}:${row.source_id}`, row)
  }
  const deduped = [...byKey.values()]

  // 6) Upsert to Supabase. Service role bypasses RLS — sync routes are
  // already protected by CRON_TOKEN.
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
