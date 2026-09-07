import { after } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { refreshCatalogueIfStale, searchRefreshEnabled } from './refresh'
import { runBoundedCatalogueRefresh } from './refresh-worker'

// This header only opts OUT of work; it grants no privileges. Admin samples
// and synthetic probes use it so they cannot consume the daily refresh.
export const SKIP_CATALOGUE_REFRESH_HEADER = 'x-gabo-skip-catalogue-refresh'

export function scheduleCatalogueRefresh(
  request: Request,
  searchSucceeded: () => boolean = () => true,
): void {
  if (!searchRefreshEnabled(process.env)) return
  if (request.headers.get(SKIP_CATALOGUE_REFRESH_HEADER) === '1') return

  try {
    after(async () => {
      // For streamed chat, this is checked only once the response completes.
      if (!searchSucceeded()) return
      try {
        const db = createServiceRoleClient()
        await refreshCatalogueIfStale({
          async claim() {
            const { data, error } = await db.rpc('claim_catalog_refresh')
              .abortSignal(AbortSignal.timeout(5000))
            if (error) throw error
            // Reject unexpected RPC output rather than treating it as a lock.
            if (data === null) return null
            if (typeof data !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data)) {
              throw new Error('Invalid catalogue refresh claim')
            }
            return data
          },
          refresh: runBoundedCatalogueRefresh,
          async finish(token, succeeded, summary) {
            const { data, error } = await db.rpc('finish_catalog_refresh', {
              p_token: token,
              p_succeeded: succeeded,
              p_summary: summary,
            }).abortSignal(AbortSignal.timeout(5000))
            if (error) throw error
            return data === true
          },
          warn: (message) => console.warn(message),
        })
      } catch {
        console.warn('[catalogue-refresh] unavailable; keeping saved catalogue')
      }
    })
  } catch {
    // Observability/hosting failures must never replace a successful search.
    console.warn('[catalogue-refresh] background scheduling unavailable')
  }
}
