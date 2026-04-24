import type { PlanCard as PlanCardType, Profile, TransitMode } from '@/lib/planner/types'
import { grabRideUrl } from '@/lib/grab-ride'
import { FairnessPill } from './FairnessPill'

type Props = {
  card: PlanCardType
  profile: Profile
  defaultMode: TransitMode
  plannerLabel: string
  partnerLabel: string
  onBook: (card: PlanCardType) => void
  onOpenDetails: (card: PlanCardType) => void
}

export function PlanCard({
  card,
  profile,
  defaultMode,
  plannerLabel,
  partnerLabel,
  onBook,
  onOpenDetails,
}: Props) {
  const badgeCopy = badgeLabel(card)
  const whyForThem = composeWhy(card, profile)

  function stop(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation()
  }

  return (
    <article
      className="group cursor-pointer overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-200 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-stone-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
      onClick={() => onOpenDetails(card)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpenDetails(card)
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`View details for ${card.name}`}
    >
      <div className="relative h-40 w-full bg-stone-100">
        {card.photo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.photo_url} alt={card.name} className="h-full w-full object-cover" />
        )}
        {badgeCopy && (
          <span className="absolute right-3 top-3 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
            {badgeCopy}
          </span>
        )}
        <span
          aria-hidden="true"
          className="absolute left-3 bottom-3 inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-stone-700 shadow-sm backdrop-blur transition group-hover:bg-white"
        >
          View details
          <span className="transition group-hover:translate-x-0.5">›</span>
        </span>
      </div>

      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="line-clamp-1 text-lg font-semibold tracking-tight">{card.name}</h3>
            {card.address && (
              <p className="line-clamp-1 text-sm text-stone-500">{card.address}</p>
            )}
          </div>
          <span
            aria-hidden="true"
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-500 transition group-hover:bg-rose-50 group-hover:text-rose-600"
          >
            ›
          </span>
        </div>

        <FairnessPill
          drivingEtaA={card.eta_a_min}
          drivingEtaB={card.eta_b_min}
          defaultMode={defaultMode}
          plannerLabel={plannerLabel}
          partnerLabel={partnerLabel}
        />

        <p className="line-clamp-3 h-[3lh] text-sm leading-snug text-stone-700">
          {whyForThem}
        </p>

        <div className="flex gap-2 pt-1" onClick={stop}>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onBook(card)
            }}
            className="flex-1 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 active:scale-[0.98]"
          >
            Book
          </button>
          <a
            href={grabRideUrl({ lat: card.lat, lng: card.lng, name: card.name })}
            onClick={stop}
            className="rounded-xl bg-[#00b14f] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#009a45] active:scale-[0.98]"
            aria-label={`Open Grab ride to ${card.name}`}
          >
            Grab ride
          </a>
        </div>
      </div>
    </article>
  )
}

// "Closing soon" previously read as permanent closure. When badge_meta carries
// an end date, show "Ends <Mon>"; otherwise "Limited run". Other badges stay
// short and unambiguous.
function badgeLabel(card: PlanCardType): string | null {
  if (card.badge === 'none') return null
  if (card.badge === 'closing_soon') {
    const ends = card.badge_meta?.ends_at as string | undefined
    if (ends) {
      const d = new Date(ends)
      if (!Number.isNaN(d.getTime())) {
        const mon = d.toLocaleString('en-SG', { month: 'short' })
        return `Ends ${d.getDate()} ${mon}`
      }
    }
    return 'Limited run'
  }
  if (card.badge === 'soft_launch') return 'Just opened'
  if (card.badge === 'critic_pick') return "Critic's pick"
  if (card.badge === 'award_fresh') return 'Award-winning'
  return null
}

function composeWhy(card: PlanCardType, profile: Profile): string {
  const lovedHit = card.cuisine_tags.find((c) => profile.cuisines_loved.includes(c))
  const vibes = profile.vibe_defaults ?? []
  const vibeHit = card.vibe_tags.find((v) => (vibes as string[]).includes(v))

  const headline = lovedHit
    ? `${pretty(lovedHit)} night — a favourite of yours`
    : vibeHit
      ? `${capitalize(vibeHit)} mood`
      : `${pretty(card.cuisine_tags[0] ?? 'Dinner')} for two`

  const tail =
    card.badge === 'closing_soon'
      ? 'limited-run pop-up, catch it while you can'
      : card.badge === 'soft_launch'
        ? 'freshly opened'
        : card.badge === 'critic_pick'
          ? "critic's pick"
          : card.badge === 'award_fresh'
            ? 'recently recognised'
            : null

  return tail ? `${headline} · ${tail}.` : `${headline}.`
}

function pretty(tag: string): string {
  return tag.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
