import type { Venue } from '@/lib/planner/types'
import { isPlaceholderBookingUrl } from '@/lib/booking-url'

// Address keywords that strongly imply a venue doesn't take reservations
// (hawker centres, food courts, coffee shops). Deliberately specific phrases
// so we don't false-positive on a restaurant that just happens to have "food"
// in its address.
const NO_RESERVATION_ADDRESS =
  /\b(food centre|food court|hawker centre|hawker|kopitiam|coffee shop)\b/i

// Hawker dish names baked into the venue's own name. Stalls almost universally
// brand themselves around the dish ("X Sliced Fish", "Y Bak Kut Teh"); proper
// restaurants don't. Whole-word \b boundaries so "Laksania" or "Pratafornia"
// don't false-hit.
const HAWKER_DISH_NAME =
  /\b(sliced fish|bak kut teh|fish head (?:curry|steamboat|noodle|bee hoon)|chicken rice|char kway teow|char kuay teow|hokkien mee|prawn mee|prawn noodle|wanton mee|wonton mee|wantan mee|nasi lemak|roti prata|laksa|kway chap|carrot cake|chai tow kway|mee pok|mee soto|mee rebus|mee siam|ban mian|yong tau foo|fishball noodle|duck rice)\b/i

// Whether a "Reserve" CTA should be shown. Precedence:
//   1. Explicit accepts_reservations column (true/false) → trust it. Populated
//      by source extractors that have a clean signal (e.g. blog-scanner's
//      Gemini step reading "walk-in only" / "reservations recommended").
//   2. Real chope_url present → yes (we trust the booking source).
//   3. Address matches hawker/food-court patterns → no.
//   4. Name brands itself around a hawker dish → no.
//   5. Otherwise → yes (assume reservations work; opening Google Search for
//      "<name> reservation" is at worst a minor no-op for the user).
//
// Events use the "Get tickets" path and don't go through here.
export function acceptsReservations(
  venue: Pick<Venue, 'name' | 'address' | 'chope_url' | 'accepts_reservations'>
): boolean {
  if (venue.accepts_reservations === true) return true
  if (venue.accepts_reservations === false) return false
  if (venue.chope_url && !isPlaceholderBookingUrl(venue.chope_url)) return true
  if (venue.address && NO_RESERVATION_ADDRESS.test(venue.address)) return false
  if (venue.name && HAWKER_DISH_NAME.test(venue.name)) return false
  return true
}
