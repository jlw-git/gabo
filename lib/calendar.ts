// Google Calendar "add event" template URL. A real, reversible action the
// booking concierge (F3) can perform without any provider API — opening this
// pre-fills a calendar event the user saves (or doesn't). No fabrication.

type CalendarEvent = {
  title: string
  start: Date
  durationMin: number
  location?: string | null
  details?: string | null
}

// UTC compact stamp Google expects: 20260606T110000Z
function gcalStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

export function googleCalendarUrl(ev: CalendarEvent): string {
  const end = new Date(ev.start.getTime() + Math.max(1, ev.durationMin) * 60_000)
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates: `${gcalStamp(ev.start)}/${gcalStamp(end)}`,
  })
  if (ev.location) params.set('location', ev.location)
  if (ev.details) params.set('details', ev.details)
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
