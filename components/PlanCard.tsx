import type { LatLng, PlanCard as PlanCardType, Profile, TransitMode } from '@/lib/planner/types'
import { isEvent } from '@/lib/planner/category'
import {
  hasAwardLabel,
  hasClosingSoonLabel,
  hasCriticPickLabel,
  hasJustOpenedLabel,
  TRENDING_THRESHOLD,
} from '@/lib/planner/badges'
import { directionsUrl } from '@/lib/directions'
import { photoUrlOrFallback } from '@/lib/photo-fallback'
import { acceptsReservations } from '@/lib/reservations'
import { FairnessPill } from './FairnessPill'
import { SourceAttribution } from './SourceAttribution'

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
  // When provided, the FairnessPill is driven by a global toggle and its own
  // per-card toggle is hidden.
  mode?: TransitMode
  onModeChange?: (mode: TransitMode) => void
  onBook: (card: PlanCardType) => void
  onOpenDetails: (card: PlanCardType) => void
  onShare?: (card: PlanCardType) => void
  onToggleShortlist?: (card: PlanCardType) => void
  // F5: "Not for us" — a negative taste signal. When provided, a skip control
  // renders; the parent removes the card and records the −1 event.
  onSkip?: (card: PlanCardType) => void
}

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
  mode,
  onModeChange,
  onBook,
  onOpenDetails,
  onShare,
  onToggleShortlist,
  onSkip,
}: Props) {
  const event = isEvent(card)
  const labels = badgeLabels(card)
  const sourceSummary =
    event && typeof card.badge_meta?.summary === 'string' ? card.badge_meta.summary.trim() : ''
  // Prefer LLM-written body copy when the planner enriched this card
  // (lib/planner/gemini-eval.ts). Falls back to the formula composer
  // when the Gemini call timed out, errored, or didn't return this id.
  const whyForThem = sourceSummary || (card.why ?? composeWhy(card, profile, labels))
  const showFairness = card.eta_a_min > 0 || card.eta_b_min > 0
  const showTrending =
    !labels.some((l) => l.key === 'closing_soon') && card.trending_score >= TRENDING_THRESHOLD
  const ring = ringForBadge(card)
  const primaryCta = event ? 'Get tickets' : 'Reserve'
  // Hawker / food-court venues don't take reservations — show Directions only.
  const showPrimaryCta = event || acceptsReservations(card)

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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photoUrlOrFallback(card)}
          alt={card.name}
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          onError={(e) => {
            const img = e.currentTarget
            if (img.dataset.fallback) return
            img.dataset.fallback = '1'
            img.src = photoUrlOrFallback({ ...card, photo_url: null })
          }}
        />

        <div className="absolute right-3 top-3 flex flex-col items-end gap-1.5">
          {labels.map((l) => (
            <span
              key={l.key}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur ${l.chipClass}`}
            >
              {l.label}
            </span>
          ))}
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
                <ShareIcon />
              </IconButton>
            )}
            {onSkip && (
              <IconButton
                onClick={(e) => {
                  e.stopPropagation()
                  onSkip(card)
                }}
                label={`Not for us — show fewer places like ${card.name}`}
              >
                <SkipIcon />
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
        <div className="min-w-0">
          <h3 className="line-clamp-1 text-lg font-semibold tracking-tight">{card.name}</h3>
          {card.address && (
            <p className="line-clamp-1 text-sm text-stone-500">{card.address}</p>
          )}
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
            mode={mode}
            onModeChange={onModeChange}
          />
        )}

        <p className="line-clamp-3 h-[3lh] text-sm leading-snug text-stone-700">
          {whyForThem}
        </p>
        {card.rank_reason && !card.why && (
          <p className="-mt-1 line-clamp-2 text-[11px] italic leading-snug text-stone-500">
            {card.rank_reason}
          </p>
        )}

        <div className="flex gap-2 pt-1" onClick={stop}>
          {showPrimaryCta && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onBook(card)
              }}
              className="flex-1 rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-800 active:scale-[0.98]"
            >
              {primaryCta}
            </button>
          )}
          <a
            href={directionsUrl({ lat: card.lat, lng: card.lng, name: card.name, address: card.address, source: card.source, source_id: card.source_id })}
            target="_blank"
            rel="noopener noreferrer"
            onClick={stop}
            className={`${
              showPrimaryCta ? '' : 'flex-1 text-center'
            } rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 ring-1 ring-stone-300 transition hover:bg-stone-50 hover:text-stone-900 active:scale-[0.98]`}
            aria-label={`Get directions to ${card.name}`}
          >
            Directions
          </a>
        </div>

        {card.source && card.source !== 'manual' && (
          <div className="pt-1" onClick={stop}>
            <SourceAttribution source={card.source} sourceUrl={card.source_url} />
          </div>
        )}
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

type LabelKey = 'closing_soon' | 'soft_launch' | 'critic_pick' | 'award_fresh'
type CardLabel = { key: LabelKey; label: string; chipClass: string }

// Multi-label rendering. Cards show every applicable badge chip, keying off
// the same predicates the filter tabs use (lib/planner/badges.ts). A chip
// visible on a card always implies the card appears under the matching
// filter tab — the two surfaces can't disagree.
function badgeLabels(card: PlanCardType): CardLabel[] {
  const out: CardLabel[] = []

  if (hasClosingSoonLabel(card)) {
    const ends = card.badge_meta?.ends_at as string
    const d = new Date(ends)
    const label = Number.isNaN(d.getTime())
      ? 'Limited run'
      : `Ends ${d.getDate()} ${d.toLocaleString('en-SG', { month: 'short' })}`
    out.push({
      key: 'closing_soon',
      label,
      chipClass: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
    })
  }

  if (hasJustOpenedLabel(card)) {
    out.push({
      key: 'soft_launch',
      label: 'Just opened',
      chipClass: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    })
  }

  if (hasCriticPickLabel(card)) {
    out.push({
      key: 'critic_pick',
      label: "Critic's pick",
      chipClass: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
    })
  }

  if (hasAwardLabel(card)) {
    out.push({
      key: 'award_fresh',
      label: 'Award-winning',
      chipClass: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
    })
  }

  return out
}

function composeWhy(card: PlanCardType, profile: Profile, labels: CardLabel[]): string {
  const event = isEvent(card)
  const summary = typeof card.badge_meta?.summary === 'string' ? card.badge_meta.summary.trim() : ''
  if (event && summary) return summary

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

  const tails = whyTails(card, labels)
  return tails.length > 0 ? `${headline} · ${tails.join(' · ')}.` : `${headline}.`
}

// One short fragment per applicable label, drawing on real metadata. Cap at
// two so the card body stays inside its line-clamp-3.
function whyTails(card: PlanCardType, labels: CardLabel[]): string[] {
  const meta = card.badge_meta ?? {}
  const tails: string[] = []

  for (const l of labels) {
    if (tails.length >= 2) break
    switch (l.key) {
      case 'closing_soon': {
        const fmt = formatEndsAt(meta.ends_at as string | undefined)
        tails.push(fmt ? `ends ${fmt}` : 'catch it before it ends')
        break
      }
      case 'soft_launch': {
        const fmt = formatOpened(meta.opened as string | undefined)
        tails.push(fmt ?? 'freshly opened')
        break
      }
      case 'critic_pick': {
        const source = typeof meta.source === 'string' ? meta.source : null
        tails.push(source ? `picked by ${source}` : "critic's pick")
        break
      }
      case 'award_fresh': {
        const award = typeof meta.award === 'string' ? meta.award : null
        tails.push(award ? award.toLowerCase() : 'recently recognised')
        break
      }
    }
  }

  if (tails.length === 0) {
    if (card.trending_score >= TRENDING_THRESHOLD) tails.push(trendingTail(card.trending_score))
    else if (isEvent(card)) {
      const fmt = formatEndsAt(card.badge_meta?.ends_at as string | undefined)
      if (fmt) tails.push(`on view until ${fmt}`)
    }
  }

  return tails
}

function ShareIcon() {
  // iOS-style share glyph (rect with up-arrow). The previous ↗ codepoint
  // looked like a generic external-link arrow, which users on this project
  // flagged as not reading as "share".
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v13" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  )
}

function SkipIcon() {
  // "No entry" circle-slash — reads as "not this one" without the finality of a
  // close ✕ (which would imply dismissing the whole list).
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </svg>
  )
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
