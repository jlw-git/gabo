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

// Date-night meal window: venue must be open at `at` AND stay open for at
// least `dwellMin` minutes inside the same window. A venue closing 15 min
// after the user's slot is technically "open" but doesn't serve the use
// case — they'd be ushered out before finishing.
//
// Same-window enforcement makes lunch/dinner-split venues (e.g. 11-15 +
// 18-22) correctly fail a 14:30 search with dwell 60 — the lunch window
// closes before the meal is over, and the dinner window hasn't started.
export function isOpenForMeal(
  hours: HoursJson | null,
  at: Date,
  phHours: HoursJson | null = null,
  dwellMin = 60
): boolean {
  const isPh = isSgPublicHoliday(sgDateKey(at))
  const active = isPh && phHours && hasAnyWindow(phHours) ? phHours : hours
  if (!active) return false
  const day = sgDayKey(at) as DayKey
  const windows = active[day] ?? []
  if (windows.length === 0) return false
  const t = hhmmToMin(sgHHMM(at))
  return windows.some((w) => {
    const open = hhmmToMin(w.open)
    let close = hhmmToMin(w.close)
    const crosses = close <= open
    if (crosses) close += 24 * 60
    // Cross-midnight window: if the slot is in the AM portion (before open),
    // it belongs to "yesterday's" window, so shift it forward 24h to compare.
    const tNorm = crosses && t < open ? t + 24 * 60 : t
    if (tNorm < open || tNorm >= close) return false
    return tNorm + dwellMin <= close
  })
}

export function isVenueOpenForMeal(
  venue: Pick<Venue, 'hours_json' | 'ph_hours_json'>,
  at: Date,
  dwellMin = 60
): boolean {
  return isOpenForMeal(venue.hours_json, at, venue.ph_hours_json, dwellMin)
}

function hhmmToMin(s: string): number {
  return Number(s.slice(0, 2)) * 60 + Number(s.slice(2))
}

function hasAnyWindow(h: HoursJson): boolean {
  for (const k of Object.keys(h) as DayKey[]) {
    if ((h[k]?.length ?? 0) > 0) return true
  }
  return false
}
