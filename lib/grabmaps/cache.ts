import type { DirectionResult } from './direction'

// In-memory TTL cache for GrabMaps Direction results. Keeps the demo resilient
// to upstream 503s — once a pair has been fetched successfully, subsequent
// plan requests reuse it. Only real (non-estimated) results are cached, so
// we'll still retry the API next time if the first attempt fell back.
// Cache clears on server restart (acceptable for hackathon).

type Entry = { value: DirectionResult; expiresAt: number }

const TTL_MS = 60 * 60 * 1000 // 1 hour

// Module-scoped map — survives between requests in the same server process.
const globalCache = globalThis as typeof globalThis & { __gaboDirCache?: Map<string, Entry> }
const store: Map<string, Entry> = globalCache.__gaboDirCache ?? new Map<string, Entry>()
globalCache.__gaboDirCache = store

export function cacheKey(
  oLng: number,
  oLat: number,
  dLng: number,
  dLat: number,
  profile: string
): string {
  return `${oLng},${oLat}|${dLng},${dLat}|${profile}`
}

export function cacheGet(key: string): DirectionResult | null {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    return null
  }
  return entry.value
}

export function cacheSet(key: string, value: DirectionResult): void {
  store.set(key, { value, expiresAt: Date.now() + TTL_MS })
}

export function cacheStats() {
  return { size: store.size }
}
