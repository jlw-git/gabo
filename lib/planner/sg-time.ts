// Day-of-week and HHMM string for `at` evaluated in Asia/Singapore, regardless
// of the host timezone. The planner runs on UTC serverless functions; using
// Date#getHours/getDay there shifts every slot by 8h and breaks the hours
// filter for SGT users.

const TZ = 'Asia/Singapore'

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
export type SgDayKey = (typeof DAY_KEYS)[number]

const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' })
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const SHORT_TO_KEY: Record<string, SgDayKey> = {
  Sun: 'sun', Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat',
}

export function sgDayKey(at: Date): SgDayKey {
  return SHORT_TO_KEY[dayFmt.format(at)] ?? 'sun'
}

export function sgHHMM(at: Date): string {
  // en-GB returns "HH:MM" (or "24:MM" at midnight in some envs); strip the colon
  // and normalize "24" → "00".
  const raw = timeFmt.format(at).replace(':', '')
  return raw.startsWith('24') ? `00${raw.slice(2)}` : raw
}

export function sgHourMinute(at: Date): { hour: number; minute: number } {
  const s = sgHHMM(at)
  return { hour: Number(s.slice(0, 2)), minute: Number(s.slice(2)) }
}
