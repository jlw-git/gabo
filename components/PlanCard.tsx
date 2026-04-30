import type { LatLng, PlanCard as PlanCardType, Profile, TransitMode } from '@/lib/planner/types'
import { isEvent } from '@/lib/planner/category'
import { directionsUrl } from '@/lib/directions'
import { FairnessPill } from './FairnessPill'

type Props = {
  card: PlanCardType
  profile: Profile
  defaultMode: TransitMode
  plannerLabel: string
  partnerLabel: string
  shortlisted?: boolean
  // Optional context to enable real public-transit ETAs in the FairnessPill.
  startA?: LatLng | null
  startB?: LatLng | null
  scheduledFor?: Date
  onBook: (card: PlanCardType) => void
  onOpenDetails: (card: PlanCardType) => void
  onShare?: (card: PlanCardType) => void
  onToggleShortlist?: (card: PlanCardType) => void
}

const TRENDING_THRESHOLD = 0.7

export function PlanCard({
  card,
  profile,
  defaultMode,
  plannerLabel,
  partnerLabel,
  shortlisted = false,
  startA = null,
  startB = null,
  scheduledFor,
  onBook,
  onOpenDetails,
  onShare,
  onToggleShortlist,
}: Props) {
  const event = isEvent(card)
  const badgeCopy = badgeLabel(card)
  const whyForThem = composeWhy(card, profile)
  const showFairness = card.eta_a_min > 0 || card.eta_b_min > 0
  const showTrending = card.badge === 'none' && card.trending_score >= TRENDING_THRESHOLD
  const ring = ringForBadge(card)
  const primaryCta = event ? 'Get tickets' : 'Reserve'

  function stop(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation()
  }

  return (
    <article
      className={`group cursor-pointer overflow-hidden rounded-2xl bg-white shadow-sm ring-1 transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 ${ring.base} ${ring.hover}`}
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
        <div className="absolute right-3 top-3 flex flex-col items-end gap-1.5">
          {badgeCopy && (
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur ${badgeChip(card)}`}>
              {badgeCopy}
            </span>
          )}
          {showTrending && (
            <span className="rounded-full bg-orange-500/90 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
              🔥 Trending
            </span>
          )}
          <div className="flex gap-1.5">
            {onToggleShortlist && (
              <IconButton
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleShortlist(card)
                }}
                label={shortlisted ? `Remove ${card.name} from shortlist` : `Add ${card.name} to shortlist`}
                pressed={shortlisted}
              >
                {shortlisted ? '★' : '☆'}
              </IconButton>
            )}
            {onShare && (
              <IconButton
                onClick={(e) => {
                  e.stopPropagation()
                  onShare(card)
                }}
                label={`Share ${card.name}`}
              >
                ↗
              </IconButton>
            )}
          </div>
        </div>
        <span className="absolute left-3 top-3 rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-stone-700 backdrop-blur">
          {event ? 'Event' : 'Dining'}
        </span>
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

        {showFairness && (
          <FairnessPill
            drivingEtaA={card.eta_a_min}
            drivingEtaB={card.eta_b_min}
            defaultMode={defaultMode}
            plannerLabel={plannerLabel}
            partnerLabel={partnerLabel}
            venue={{ lat: card.lat, lng: card.lng }}
            startA={startA}
            startB={startB}
            scheduledFor={scheduledFor}
          />
        )}

        <p className="line-clamp-3 h-[3lh] text-sm leading-snug text-stone-700">
          {whyForThem}
        </p>

        <div className="flex gap-2 pt-1" onClick={stop}>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onBook(card)
            }}
            className="flex-1 rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-800 active:scale-[0.98]"
          >
            {primaryCta}
          </button>
          <a
            href={directionsUrl({ lat: card.lat, lng: card.lng, name: card.name })}
            target="_blank"
            rel="noopener noreferrer"
            onClick={stop}
            className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 ring-1 ring-stone-300 transition hover:bg-stone-50 hover:text-stone-900 active:scale-[0.98]"
            aria-label={`Get directions to ${card.name}`}
          >
            Directions
          </a>
        </div>
      </div>
    </article>
  )
}

function IconButton({
  children,
  onClick,
  label,
  pressed,
}: {
  children: React.ReactNode
  onClick: (e: React.MouseEvent) => void
  label: string
  pressed?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onKeyDown={(e) => e.stopPropagation()}
      aria-label={label}
      aria-pressed={pressed}
      className={`flex h-8 w-8 items-center justify-center rounded-full text-base shadow-sm backdrop-blur transition active:scale-95 ${
        pressed
          ? 'bg-rose-600 text-white hover:bg-rose-700'
          : 'bg-white/95 text-stone-700 hover:bg-white'
      }`}
    >
      {children}
    </button>
  )
}

// Badge-driven highlighting. Ring colour signals "this one's worth a look"
// before the user reads the badge text — closing-soon pop-ups in particular
// are time-sensitive so they earn a stronger visual cue.
function ringForBadge(card: PlanCardType): { base: string; hover: string } {
  switch (card.badge) {
    case 'closing_soon':
      return { base: 'ring-rose-300', hover: 'hover:ring-rose-400' }
    case 'soft_launch':
      return { base: 'ring-emerald-300', hover: 'hover:ring-emerald-400' }
    case 'critic_pick':
      return { base: 'ring-amber-300', hover: 'hover:ring-amber-400' }
    case 'award_fresh':
      return { base: 'ring-violet-300', hover: 'hover:ring-violet-400' }
    default:
      return { base: 'ring-stone-200', hover: 'hover:ring-stone-300' }
  }
}

function badgeChip(card: PlanCardType): string {
  // Soft, low-saturation chips so the card content (photo, name) leads.
  // The card ring still signals urgency for time-sensitive badges.
  switch (card.badge) {
    case 'closing_soon':
      return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
    case 'soft_launch':
      return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
    case 'critic_pick':
      return 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
    case 'award_fresh':
      return 'bg-violet-50 text-violet-700 ring-1 ring-violet-200'
    default:
      return 'bg-white/90 text-stone-700 ring-1 ring-stone-200'
  }
}

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
  const event = isEvent(card)
  const lovedHit = card.cuisine_tags.find((c) => profile.cuisines_loved.includes(c))
  const vibes = profile.vibe_defaults ?? []
  const vibeHit = card.vibe_tags.find((v) => (vibes as string[]).includes(v))

  const headline = event
    ? eventHeadline(card, vibeHit)
    : lovedHit
      ? `${pretty(lovedHit)} night — a favourite of yours`
      : vibeHit
        ? `${capitalize(vibeHit)} mood`
        : `${pretty(card.cuisine_tags[0] ?? 'Dinner')} for two`

  const tail = whyTail(card)
  return tail ? `${headline} · ${tail}.` : `${headline}.`
}

// Real signal where we have it — concrete dates beat platitudes.
function whyTail(card: PlanCardType): string | null {
  switch (card.badge) {
    case 'closing_soon': {
      const fmt = formatEndsAt(card.badge_meta?.ends_at as string | undefined)
      return fmt ? `ends ${fmt}` : 'catch it before it ends'
    }
    case 'soft_launch': {
      const fmt = formatOpened(card.badge_meta?.opened as string | undefined)
      return fmt ?? 'freshly opened'
    }
    case 'critic_pick': {
      const source = card.badge_meta?.source as string | undefined
      return source ? `picked by ${source}` : "critic's pick"
    }
    case 'award_fresh': {
      const award = card.badge_meta?.award as string | undefined
      return award ? award.toLowerCase() : 'recently recognised'
    }
    case 'none':
    default:
      // Trending venues with no other badge get a trending-flavoured tail.
      // Real product would surface aggregated saves/searches; for the demo
      // we map the seeded score to a qualitative band — no fake numbers.
      if (card.trending_score >= TRENDING_THRESHOLD) return trendingTail(card.trending_score)
      return null
  }
}

function formatEndsAt(iso: string | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const mon = d.toLocaleString('en-SG', { month: 'short' })
  return `${d.getDate()} ${mon}`
}

function formatOpened(iso: string | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const days = Math.max(0, Math.round((Date.now() - d.getTime()) / 86_400_000))
  if (days <= 1) return 'opened today'
  if (days < 14) return `opened ${days} days ago`
  if (days < 60) return `opened ${Math.round(days / 7)} weeks ago`
  const month = d.toLocaleString('en-SG', { month: 'long' })
  return d.getFullYear() === new Date().getFullYear()
    ? `open since ${month}`
    : `open since ${month} ${d.getFullYear()}`
}

function trendingTail(score: number): string {
  if (score >= 0.9) return 'most-shortlisted this week'
  if (score >= 0.8) return 'shortlisted often this week'
  return 'picking up steam this week'
}

function eventHeadline(card: PlanCardType, vibeHit: string | undefined): string {
  const SPECIAL = new Set(['art', 'exhibition', 'music', 'games', 'outdoor', 'nature', 'nightlife'])
  const primary = card.cuisine_tags.find((t) => SPECIAL.has(t)) ?? 'experience'
  const label = pretty(primary)
  if (vibeHit) return `${capitalize(vibeHit)} ${label.toLowerCase()}`
  return label
}

function pretty(tag: string): string {
  return tag.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
