// Resolve a venue's booking link, with a graceful fallback to a Google search
// when the catalog has no real URL or the placeholder Chope rIDs we seeded
// during the hackathon return 404. Treats the Chope placeholder pattern as
// "not real" so we don't open a dead booking page.

import { isEvent } from '@/lib/planner/category'
import type { PlanCard } from '@/lib/planner/types'

const CHOPE_PLACEHOLDER_PATTERN = /^https?:\/\/book\.chope\.co\/booking\?rid=/i

export function bookingUrl(card: Pick<PlanCard, 'name' | 'cuisine_tags' | 'chope_url'>): string {
  const candidate = card.chope_url?.trim()
  if (candidate && !looksPlaceholder(candidate)) return candidate
  return googleSearchFallback(card.name, isEvent(card as PlanCard))
}

export function isPlaceholderBookingUrl(url: string | null | undefined): boolean {
  if (!url) return true
  return looksPlaceholder(url.trim())
}

function looksPlaceholder(url: string): boolean {
  // The hackathon-era catalog seeded book.chope.co/booking?rid=<slug> patterns
  // that aren't verified against real Chope reservation IDs. Treat them as
  // unreliable until the catalog is curated against real listings.
  return CHOPE_PLACEHOLDER_PATTERN.test(url)
}

function googleSearchFallback(name: string, event: boolean): string {
  const q = event
    ? `${name} singapore tickets`
    : `${name} singapore reservation`
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`
}
