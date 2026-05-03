import type { Venue } from '@/lib/planner/types'
import { isPlaceholderBookingUrl } from '@/lib/booking-url'

// Address keywords that strongly imply a venue doesn't take reservations
// (hawker centres, food courts, coffee shops). Deliberately specific phrases
// so we don't false-positive on a restaurant that just happens to have "food"
// in its address.
const NO_RESERVATION_ADDRESS =
  /\b(food centre|food court|hawker centre|hawker|kopitiam|coffee shop)\b/i

// Whether a "Reserve" CTA should be shown. Conservative defaults:
//   - Real chope_url present → yes (we trust the booking source)
//   - Address matches hawker/food-court patterns AND no real chope_url → no
//   - Otherwise → yes (assume reservations work; opening Google Search for
//     "<name> reservation" is at worst a minor no-op for the user)
//
// Events use the "Get tickets" path and don't go through here.
export function acceptsReservations(
  venue: Pick<Venue, 'address' | 'chope_url'>
): boolean {
  if (venue.chope_url && !isPlaceholderBookingUrl(venue.chope_url)) return true
  if (venue.address && NO_RESERVATION_ADDRESS.test(venue.address)) return false
  return true
}
