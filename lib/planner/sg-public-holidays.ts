// Singapore public-holiday calendar used by isOpenAt() to switch from
// hours_json (weekday hours) to ph_hours_json when the scheduled date is a PH.
//
// Source of truth: https://www.mom.gov.sg/employment-practices/public-holidays
// SG gazettes the next calendar year's holidays in mid-year (e.g. 2027 lands
// around June 2026). The maintainer should re-pull from MOM annually and
// append the new year's dates here.
//
// Dates are SGT calendar days — match against sgDateKey() (lib/planner/sg-time.ts).
// Missing a holiday is a safe failure mode: the planner falls back to
// hours_json (regular weekday hours), which is the previous behaviour.

const SG_PUBLIC_HOLIDAYS = new Set<string>([
  // 2026 — full gazette per mom.gov.sg/employment-practices/public-holidays
  '2026-01-01', // New Year's Day
  '2026-02-17', // Chinese New Year (day 1)
  '2026-02-18', // Chinese New Year (day 2)
  '2026-03-21', // Hari Raya Puasa
  '2026-04-03', // Good Friday
  '2026-05-01', // Labour Day
  '2026-05-27', // Hari Raya Haji
  '2026-05-31', // Vesak Day
  '2026-06-01', // Vesak Day — public holiday in lieu (31 May was a Sunday)
  '2026-08-09', // National Day
  '2026-08-10', // National Day — public holiday in lieu (9 Aug was a Sunday)
  '2026-11-08', // Deepavali
  '2026-11-09', // Deepavali — public holiday in lieu (8 Nov was a Sunday)
  '2026-12-25', // Christmas Day

  // 2027 — MOM has not gazetted 2027 yet (typically published mid-2026).
  // Fixed-date holidays only until the full list is added; lunar / Islamic
  // dates must come from the MOM page when gazetted.
  '2027-01-01', // New Year's Day
  '2027-05-01', // Labour Day
  '2027-08-09', // National Day
  '2027-12-25', // Christmas Day
])

export function isSgPublicHoliday(sgDateKey: string): boolean {
  return SG_PUBLIC_HOLIDAYS.has(sgDateKey)
}
