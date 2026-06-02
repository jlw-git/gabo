// Booking-concierge action plan (F3 scaffold). Given a chosen venue + slot,
// enumerate the actions the concierge proposes, each classified by reversibility
// tier. The TIER CLASSIFICATION IS DETERMINISTIC CODE — it's what decides which
// actions need an explicit human gate (roadmap principle #2). No LLM, no
// fabrication: 'reserve' opens the real provider page, it never books for you.

import { bookingUrl, isPlaceholderBookingUrl } from '@/lib/booking-url'
import { isEvent } from '@/lib/planner/category'
import type { PlanCard } from '@/lib/planner/types'

export type ActionTier = 'irreversible' | 'reversible' | 'outward'
export type ActionKind = 'reserve' | 'calendar' | 'share'

export type BookingAction = {
  kind: ActionKind
  tier: ActionTier
  label: string
  detail: string
}

// Human-readable provider name for the reserve linkout — honest about where the
// booking actually completes.
export function providerName(card: Pick<PlanCard, 'chope_url'>): string {
  return isPlaceholderBookingUrl(card.chope_url) ? 'Google search' : 'Chope'
}

export function buildActionPlan(
  card: PlanCard,
  scheduledFor: Date,
  partySize: number
): BookingAction[] {
  const event = isEvent(card)
  const provider = event ? 'the event page' : providerName(card)
  const verb = event ? 'Get tickets' : 'Reserve'
  const partyText = event ? '' : ` for ${partySize}`

  return [
    {
      kind: 'reserve',
      // Outward + irreversible-once-completed: this is the gated action. We only
      // open the provider; the human completes it there.
      tier: 'irreversible',
      label: `${verb}${partyText} at ${card.name}`,
      detail: `Opens ${provider} in a new tab — you complete the booking there. We never book on your behalf.`,
    },
    {
      kind: 'calendar',
      tier: 'reversible',
      label: 'Add to your calendar',
      detail: 'Pre-fills a calendar event you can save (or not).',
    },
    {
      kind: 'share',
      tier: 'outward',
      label: 'Send the plan to your partner',
      detail: 'You edit the message before anything is sent — never auto-sent.',
    },
  ]
}

// Booking link for the reserve action (real Chope / Google fallback).
export function reserveUrl(card: PlanCard): string {
  return bookingUrl(card)
}
