// The database owns freshness and locking. No in-memory timer or retry can
// bypass the shared 24-hour attempt budget, including across deployments.
export type RefreshSummary = Record<string, string | number | boolean>

export type CatalogueRefreshDeps = {
  claim: () => Promise<string | null>
  refresh: () => Promise<RefreshSummary>
  finish: (token: string, succeeded: boolean, summary: RefreshSummary) => Promise<boolean>
  warn: (message: string) => void
}

export async function refreshCatalogueIfStale(deps: CatalogueRefreshDeps): Promise<void> {
  let token: string | null
  try {
    token = await deps.claim()
  } catch {
    // Missing migration, unavailable database, or ambiguous claim response:
    // never spend on discovery without a confirmed claim.
    deps.warn('[catalogue-refresh] claim unavailable; refresh skipped')
    return
  }
  if (!token) return

  let succeeded = false
  let summary: RefreshSummary
  try {
    summary = await deps.refresh()
    succeeded = true
  } catch {
    // Avoid storing provider errors containing credentials or request content.
    summary = { error: 'Catalogue refresh failed; the next attempt remains rate-limited.' }
    deps.warn('[catalogue-refresh] refresh failed; keeping saved catalogue')
  }

  try {
    if (!await deps.finish(token, succeeded, summary)) {
      deps.warn('[catalogue-refresh] completion ignored; lease expired or replaced')
    }
  } catch {
    // The claim already consumed the day's attempt. Do not release it or retry.
    deps.warn('[catalogue-refresh] completion unavailable; cooldown remains in place')
  }
}

export function searchRefreshEnabled(env: {
  NODE_ENV?: string
  VERCEL_ENV?: string
  SEARCH_CATALOGUE_REFRESH_ENABLED?: string
}): boolean {
  const flag = env.SEARCH_CATALOGUE_REFRESH_ENABLED?.trim().toLowerCase()
  if (flag === 'false' || flag === '0' || flag === 'off') return false
  // Preview and development searches must not consume the production budget.
  if (env.VERCEL_ENV && env.VERCEL_ENV !== 'production') return false
  return env.NODE_ENV === 'production'
}
