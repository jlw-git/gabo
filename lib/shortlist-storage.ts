// Shortlist persistence — venue IDs the user has marked while reviewing a
// plan. localStorage-only so it works without auth.

const KEY = 'gabo:shortlist-v1'

export function loadShortlist(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}

export function saveShortlist(ids: string[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...new Set(ids)]))
  } catch {
    /* quota or private mode — silently drop */
  }
}

export function clearShortlist() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
