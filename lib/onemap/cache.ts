// In-memory caches for OneMap. Two stores: token cache (single entry) and
// route cache (per origin→dest pair). Survives between requests in the same
// server process; clears on restart (acceptable for a small app).

type RouteEntry<T> = { value: T; expiresAt: number }

const ROUTE_TTL_MS = 60 * 60 * 1000 // 1h — driving times don't change minute-to-minute

const g = globalThis as typeof globalThis & {
  __gaboOnemapToken?: { token: string; expiresAt: number } | null
  __gaboOnemapRoutes?: Map<string, RouteEntry<unknown>>
}

const routes = g.__gaboOnemapRoutes ?? new Map<string, RouteEntry<unknown>>()
g.__gaboOnemapRoutes = routes

export const tokenStore = {
  get(): { token: string; expiresAt: number } | null {
    return g.__gaboOnemapToken ?? null
  },
  set(token: string, expiresAt: number): void {
    g.__gaboOnemapToken = { token, expiresAt }
  },
  clear(): void {
    g.__gaboOnemapToken = null
  },
}

export function routeKey(
  oLng: number,
  oLat: number,
  dLng: number,
  dLat: number,
  mode: string,
  bucket?: string
): string {
  return `${oLng.toFixed(5)},${oLat.toFixed(5)}|${dLng.toFixed(5)},${dLat.toFixed(5)}|${mode}${
    bucket ? `|${bucket}` : ''
  }`
}

export function cacheGet<T>(key: string): T | null {
  const entry = routes.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    routes.delete(key)
    return null
  }
  return entry.value as T
}

export function cacheSet<T>(key: string, value: T, ttlMs = ROUTE_TTL_MS): void {
  routes.set(key, { value, expiresAt: Date.now() + ttlMs })
}

export function cacheStats() {
  return { size: routes.size }
}
