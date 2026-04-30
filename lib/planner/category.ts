import type { Venue } from './types'

// Source of truth for the dining-vs-event split. The catalog overloads
// cuisine_tags with the literal 'experience' for non-eatery venues; that's
// our category signal until we add a proper `category` column.
export function isEvent(venue: Pick<Venue, 'cuisine_tags'>): boolean {
  return venue.cuisine_tags.includes('experience')
}

export function categoryOf(venue: Pick<Venue, 'cuisine_tags'>): 'dining' | 'event' {
  return isEvent(venue) ? 'event' : 'dining'
}
