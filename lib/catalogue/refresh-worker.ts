import { createServiceRoleClient } from '@/lib/supabase/server'
import { editorialEventToVenue } from '@/lib/sources/editorial-events'
import { discoverFreshEvents } from '@/lib/sources/fresh-event-discovery'

export type BoundedCatalogueRefreshSummary = {
  scope: 'fresh-events'
  proposed: number
  accepted: number
  rejected: number
  upserted: number
}

/** Only call after acquiring the shared database refresh claim. */
export async function runBoundedCatalogueRefresh(): Promise<BoundedCatalogueRefreshSummary> {
  const signal = AbortSignal.timeout(90_000)
  // One grounded generation, no SDK retries, at most ten verified events.
  // Do not invoke the full cron pipeline here: each source can fan out into
  // many paid calls. This small refresh covers time-sensitive events only.
  const discovery = await discoverFreshEvents(new Date(), {
    strict: true,
    signal,
    singleAttempt: true,
    feature: 'catalogue-refresh',
    maxOutputTokens: 4096,
    thinkingBudget: 1024,
  })
  signal.throwIfAborted()
  if (discovery.errors.length > 0) throw new Error(discovery.errors.join('; '))
  if (discovery.proposed > 0 && discovery.accepted === 0) {
    throw new Error('Catalogue refresh could not verify any proposed events')
  }

  // Distinct titles can share a normalised source id; avoid duplicate conflict
  // keys in the same atomic upsert.
  const byKey = new Map(discovery.events.map((event) => {
    const row = editorialEventToVenue(event)
    return [`${row.source}:${row.source_id}`, row] as const
  }))
  const rows = [...byKey.values()]
  let upserted = 0
  if (rows.length > 0) {
    const { error, count } = await createServiceRoleClient()
      .from('venues')
      .upsert(rows, { onConflict: 'source,source_id', count: 'exact' })
      .abortSignal(signal)
    if (error) throw new Error(`Catalogue refresh upsert failed: ${error.message}`)
    upserted = count ?? rows.length
  }

  return {
    scope: 'fresh-events',
    proposed: discovery.proposed,
    accepted: discovery.accepted,
    rejected: discovery.rejected,
    upserted,
  }
}
