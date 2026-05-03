import type { Venue } from '@/lib/planner/types'
import { isEvent } from '@/lib/planner/category'

// Generic placeholder card images, used when a venue has no photo (typical
// for blog-sourced rows where Gemini couldn't pick a verifiable URL).
// Picked by category + cuisine type so the fallback at least signals what
// kind of place it is.
export function photoUrlOrFallback(card: Pick<Venue, 'photo_url' | 'cuisine_tags'>): string {
  if (card.photo_url) return card.photo_url
  if (isEvent(card)) return '/img/fallback/event.svg'
  const tags = card.cuisine_tags ?? []
  if (tags.includes('bar') || tags.includes('cocktail')) return '/img/fallback/bar.svg'
  if (tags.includes('cafe') || tags.includes('bakery') || tags.includes('dessert') || tags.includes('brunch'))
    return '/img/fallback/cafe.svg'
  return '/img/fallback/dining.svg'
}
