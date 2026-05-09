import type { DayKey, HoursJson } from './types'
import { sgDayKey, sgHHMM } from './sg-time'

// Handles windows that cross midnight (e.g. open 1700, close 0200).
// TODO: swap `hours` for `ph_hours_json` when the scheduled_for date is a SG
// public holiday. PH calendar lookup is out of scope for v1.
export function isOpenAt(hours: HoursJson | null, at: Date): boolean {
  if (!hours) return false
  const day = sgDayKey(at) as DayKey
  const windows = hours[day] ?? []
  if (windows.length === 0) return false
  const t = sgHHMM(at)
  return windows.some((w) => {
    if (w.close < w.open) {
      return t >= w.open || t < w.close
    }
    return t >= w.open && t < w.close
  })
}
