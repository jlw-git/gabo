// Minimal local audit trail for the booking concierge (F3). Every confirmed
// booking action set is appended to localStorage so there's a record of what
// the concierge did on the user's behalf (the "audit every action" safeguard).
// localStorage-only, like shortlist/profile — no auth, no server write.

const KEY = 'gabo:booking-log-v1'
const MAX_ENTRIES = 100

export type BookingLogEntry = {
  at: string
  venue_id: string
  name: string
  party_size: number
  actions: string[] // action kinds confirmed, e.g. ['reserve','calendar']
}

export function loadBookingLog(): BookingLogEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as BookingLogEntry[]) : []
  } catch {
    return []
  }
}

export function recordBooking(entry: Omit<BookingLogEntry, 'at'>): void {
  if (typeof window === 'undefined') return
  try {
    const log = loadBookingLog()
    log.push({ at: new Date().toISOString(), ...entry })
    window.localStorage.setItem(KEY, JSON.stringify(log.slice(-MAX_ENTRIES)))
  } catch {
    /* quota / private mode — silently drop */
  }
}
