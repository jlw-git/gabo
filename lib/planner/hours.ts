import type { DayKey, HoursJson, Venue } from './types'
import { sgDateKey, sgDayKey, sgHHMM } from './sg-time'
import { isSgPublicHoliday } from './sg-public-holidays'

// Handles windows that cross midnight (e.g. open 1700, close 0200).
//
// PH-aware: when `at` falls on an SG public holiday and the venue has a
// non-empty `ph_hours_json`, that schedule is consulted instead of the
// weekday `hours_json`. Venues without PH hours data fall back to weekday
// hours, which matches the pre-PH-aware behaviour.
export function isOpenAt(
  hours: HoursJson | null,
  at: Date,
  phHours: HoursJson | null = null
): boolean {
  const isPh = isSgPublicHoliday(sgDateKey(at))
  const active = isPh && phHours && hasAnyWindow(phHours) ? phHours : hours
  if (!active) return false
  const day = sgDayKey(at) as DayKey
  const windows = active[day] ?? []
  if (windows.length === 0) return false
  const t = sgHHMM(at)
  return windows.some((w) => {
    if (w.close < w.open) {
      return t >= w.open || t < w.close
    }
    return t >= w.open && t < w.close
  })
}

// Convenience wrapper that pulls both schedules off the venue row in one call.
export function isVenueOpenAt(venue: Pick<Venue, 'hours_json' | 'ph_hours_json'>, at: Date): boolean {
  return isOpenAt(venue.hours_json, at, venue.ph_hours_json)
}

function hasAnyWindow(h: HoursJson): boolean {
  for (const k of Object.keys(h) as DayKey[]) {
    if ((h[k]?.length ?? 0) > 0) return true
  }
  return false
}
