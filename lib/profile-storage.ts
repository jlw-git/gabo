import type { Profile } from '@/lib/planner/types'
import type { PlaceSelection } from '@/components/PlaceSearchInput'

const PROFILE_KEY = 'gabo:profile-v2'
const LAST_STARTS_KEY = 'gabo:last-starts-v1'

export type StoredProfile = {
  profile: Profile
  saved_at: string
}

export type LastStarts = {
  start_a: PlaceSelection
  start_b: PlaceSelection
  saved_at: string
}

export function loadStoredProfile(): StoredProfile | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredProfile
    if (!parsed?.profile) return null
    return parsed
  } catch {
    return null
  }
}

export function saveStoredProfile(profile: Profile): void {
  if (typeof window === 'undefined') return
  const payload: StoredProfile = { profile, saved_at: new Date().toISOString() }
  localStorage.setItem(PROFILE_KEY, JSON.stringify(payload))
}

export function clearStoredProfile(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(PROFILE_KEY)
}

export function loadLastStarts(): LastStarts | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(LAST_STARTS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LastStarts
    if (!parsed?.start_a || !parsed?.start_b) return null
    return parsed
  } catch {
    return null
  }
}

export function saveLastStarts(start_a: PlaceSelection, start_b: PlaceSelection): void {
  if (typeof window === 'undefined') return
  const payload: LastStarts = { start_a, start_b, saved_at: new Date().toISOString() }
  localStorage.setItem(LAST_STARTS_KEY, JSON.stringify(payload))
}
