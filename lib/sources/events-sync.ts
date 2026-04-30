// Events catalog sync. Combines two real sources:
//   1. Bandsintown — SG concerts (free API, real ticket links)
//   2. Editorial — hand-curated SG exhibitions/pop-ups (mandatory source_url
//      pointing to the official public page)
//
// Future: museum scrapers (ArtScience, NHB, NGS, SAM) and Sistic. Held back
// until each parser is validated separately — broken scrapers silently
// poison the catalog.
//
// Run via /api/cron/sync-events (daily) or manually.

import { createClient } from '@/lib/supabase/server'
import {
  BandsintownAuthError,
  bandsintownEventToVenue,
  fetchSingaporeConcerts,
} from './bandsintown'
import { EDITORIAL_EVENTS, editorialEventToVenue } from './editorial-events'

export type EventsSyncSummary = {
  refreshed_at: string
  bandsintown_events: number
  bandsintown_error: string | null
  editorial_events: number
  upserted: number
  errors: string[]
}

export async function syncEventsCatalog(): Promise<EventsSyncSummary> {
  const summary: EventsSyncSummary = {
    refreshed_at: new Date().toISOString(),
    bandsintown_events: 0,
    bandsintown_error: null,
    editorial_events: 0,
    upserted: 0,
    errors: [],
  }

  type AnyRow =
    | ReturnType<typeof bandsintownEventToVenue>
    | ReturnType<typeof editorialEventToVenue>

  const collected: AnyRow[] = []

  // 1) Bandsintown concerts. Skip silently on auth failure (no app_id set);
  // log other errors but continue with editorial.
  try {
    const events = await fetchSingaporeConcerts()
    summary.bandsintown_events = events.length
    for (const e of events) collected.push(bandsintownEventToVenue(e))
  } catch (err) {
    if (err instanceof BandsintownAuthError) {
      summary.bandsintown_error = 'BANDSINTOWN_APP_ID not set'
    } else {
      summary.bandsintown_error = err instanceof Error ? err.message : 'unknown'
    }
  }

  // 2) Editorial events — always present, no API dependency.
  for (const e of EDITORIAL_EVENTS) {
    collected.push(editorialEventToVenue(e))
    summary.editorial_events += 1
  }

  // 3) Dedup by source_id. Editorial entries always win (they're curated)
  // over an automated source for the same venue.
  const byKey = new Map<string, AnyRow>()
  for (const row of collected) {
    const key = `${row.source}:${row.source_id}`
    byKey.set(key, row) // last-write-wins; editorial is appended after
  }
  const deduped = [...byKey.values()]

  // 4) Upsert to Supabase.
  const supabase = await createClient()
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
