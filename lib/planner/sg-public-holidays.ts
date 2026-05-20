// Singapore public-holiday calendar used by isOpenAt() to switch from
// hours_json (weekday hours) to ph_hours_json when the scheduled date is a PH.
//
// Source of truth: https://www.mom.gov.sg/employment-practices/public-holidays
// SG publishes the next calendar year's holidays well in advance, so we keep
// them as a static date set keyed by YYYY-MM-DD (SGT). The maintainer should
// append the following year's gazetted dates here once a year.
//
// Coverage is partial: fixed-date holidays only. Lunar / Islamic holidays
// (CNY, Vesak, Hari Raya Puasa/Haji, Deepavali) shift each year — add them
// from the MOM page when they're gazetted. Missing a holiday is a safe
// failure mode: the planner falls back to hours_json (regular weekday hours),
// which is the previous behaviour for every day.
//
// Dates are SGT calendar days — match against sgDayKey()'s sibling
// sgDateKey() which formats Date instances as YYYY-MM-DD in SGT.

const SG_PUBLIC_HOLIDAYS_FIXED = new Set<string>([
  // 2026
  '2026-01-01', // New Year's Day
  '2026-05-01', // Labour Day
  '2026-08-09', // National Day
  '2026-12-25', // Christmas Day

  // 2027
  '2027-01-01', // New Year's Day
  '2027-05-01', // Labour Day
  '2027-08-09', // National Day
  '2027-12-25', // Christmas Day
])

export function isSgPublicHoliday(sgDateKey: string): boolean {
  return SG_PUBLIC_HOLIDAYS_FIXED.has(sgDateKey)
}
