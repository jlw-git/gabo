'use client'

import { useMemo } from 'react'
import type { DayKey, HoursWindow, PlanCard as PlanCardType, Profile, TransitMode } from '@/lib/planner/types'
import { isEvent } from '@/lib/planner/category'
import { directionsUrl } from '@/lib/directions'
import { photoUrlOrFallback } from '@/lib/photo-fallback'
import { FairnessPill } from './FairnessPill'
import { SourceAttribution } from './SourceAttribution'
import { VenueMiniMap } from './VenueMiniMap'
import type { PlaceSelection } from './PlaceSearchInput'

type Props = {
  card: PlanCardType
  profile: Profile
  defaultMode: TransitMode
  startA?: PlaceSelection
  startB?: PlaceSelection
  // When provided, FairnessPill can fetch real public-transit ETAs.
  scheduledFor?: Date
  // Full result set so we can surface cross-category nearby picks at the
  // bottom of the modal. Pass undefined to suppress the cross-recs section.
  allCards?: PlanCardType[]
  shortlisted?: boolean
  onSelectCrossRec?: (card: PlanCardType) => void
  onBook: (card: PlanCardType) => void
  onShare?: (card: PlanCardType) => void
  onToggleShortlist?: (card: PlanCardType) => void
  onClose: () => void
}

const DAY_ORDER: { key: DayKey; label: string }[] = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
]

const BADGE_COPY: Record<string, string> = {
  closing_soon: 'Limited run',
  soft_launch: 'Just opened',
  critic_pick: "Critic's pick",
  award_fresh: 'Award-winning',
}

const CROSS_REC_LIMIT = 3
const CROSS_REC_MAX_KM = 6

export function VenueDetailModal({
  card,
  profile,
  defaultMode,
  startA,
  startB,
  scheduledFor,
  allCards,
  shortlisted = false,
  onSelectCrossRec,
  onBook,
  onShare,
  onToggleShortlist,
  onClose,
}: Props) {
  const todayKey = todayDayKey()
  const badge = card.badge !== 'none' ? BADGE_COPY[card.badge] : null
  const event = isEvent(card)
  const budgetLabel = '$'.repeat(card.budget_band)
  const plannerLabel = profile.planner_name?.trim() || 'You'
  const partnerLabel = profile.partner_name?.trim() || 'Partner'
  const showFairness = card.eta_a_min > 0 || card.eta_b_min > 0
  const primaryCta = event ? 'Get tickets' : 'Reserve'

  const crossRecs = useMemo(() => {
    if (!allCards || !onSelectCrossRec) return []
    const oppositeIsEvent = !event
    return allCards
      .filter((c) => c.id !== card.id && isEvent(c) === oppositeIsEvent)
      .map((c) => ({ c, km: distanceKm(card, c) }))
      .filter((x) => x.km <= CROSS_REC_MAX_KM)
      .sort((a, b) => a.km - b.km)
      .slice(0, CROSS_REC_LIMIT)
  }, [allCards, onSelectCrossRec, event, card])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[95vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white shadow-xl sm:max-h-[90vh] sm:rounded-3xl md:max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative h-56 w-full bg-stone-100">
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

          <div className="absolute right-3 top-3 flex gap-2">
            {onToggleShortlist && (
              <button
                onClick={() => onToggleShortlist(card)}
                aria-label={shortlisted ? `Remove ${card.name} from shortlist` : `Add ${card.name} to shortlist`}
                aria-pressed={shortlisted}
                className={`flex h-9 w-9 items-center justify-center rounded-full text-base shadow backdrop-blur transition ${
                  shortlisted ? 'bg-rose-600 text-white' : 'bg-white/90 text-stone-700 hover:bg-white'
                }`}
              >
                {shortlisted ? '★' : '☆'}
              </button>
            )}
            {onShare && (
              <button
                onClick={() => onShare(card)}
                aria-label={`Share ${card.name}`}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-stone-700 shadow backdrop-blur hover:bg-white"
              >
                ↗
              </button>
            )}
            <button
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-stone-700 shadow backdrop-blur hover:bg-white"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          {badge && (
            <span className="absolute left-3 top-3 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
              {badge}
            </span>
          )}
        </div>

        <div className="space-y-5 p-5 pb-7">
          <div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-stone-500">
                  {event ? 'Event' : 'Dining'}
                </span>
                <h2 className="text-2xl font-semibold tracking-tight">{card.name}</h2>
                {card.address && <p className="mt-0.5 text-sm text-stone-500">{card.address}</p>}
                {card.source && card.source !== 'manual' && (
                  <div className="mt-1.5">
                    <SourceAttribution source={card.source} sourceUrl={card.source_url} />
                  </div>
                )}
              </div>
              {!event && (
                <span className="whitespace-nowrap rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-700">
                  {budgetLabel}
                </span>
              )}
            </div>
          </div>

          {showFairness && (
            <FairnessPill
              drivingEtaA={card.eta_a_min}
              drivingEtaB={card.eta_b_min}
              defaultMode={defaultMode}
              plannerLabel={plannerLabel}
              partnerLabel={partnerLabel}
              venue={{ lat: card.lat, lng: card.lng }}
              startA={startA ? { lat: startA.lat, lng: startA.lng } : null}
              startB={startB ? { lat: startB.lat, lng: startB.lng } : null}
              scheduledFor={scheduledFor}
            />
          )}

          <VenueMiniMap
            venue={{ lat: card.lat, lng: card.lng, name: card.name }}
            startA={startA ? { point: { lat: startA.lat, lng: startA.lng }, label: `${plannerLabel} · ${startA.label}` } : undefined}
            startB={startB ? { point: { lat: startB.lat, lng: startB.lng }, label: `${partnerLabel} · ${startB.label}` } : undefined}
          />

          {card.badge !== 'none' && card.badge_meta && (
            <BadgeDetail badge={card.badge} meta={card.badge_meta} />
          )}

          <Section title="Opening hours">
            <div className="rounded-xl bg-stone-50 p-3 ring-1 ring-stone-200">
              {DAY_ORDER.map((d) => (
                <div
                  key={d.key}
                  className={`flex items-center justify-between py-1 text-sm ${
                    d.key === todayKey ? 'font-semibold text-stone-900' : 'text-stone-700'
                  }`}
                >
                  <span className="w-12 text-stone-500">{d.label}{d.key === todayKey && <span className="ml-1 text-rose-600">•</span>}</span>
                  <span>{formatWindows(card.hours_json?.[d.key])}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title={event ? 'Type' : 'Cuisine'}>
            <TagRow tags={card.cuisine_tags} emphasized={profile.cuisines_loved} />
          </Section>

          {card.vibe_tags.length > 0 && (
            <Section title="Vibe">
              <TagRow tags={card.vibe_tags} emphasized={profile.vibe_defaults} />
            </Section>
          )}

          {card.dietary_flags.length > 0 && (
            <Section title="Dietary">
              <TagRow tags={card.dietary_flags} emphasized={profile.dietary_hardstops} />
            </Section>
          )}

          {crossRecs.length > 0 && onSelectCrossRec && (
            <Section title={event ? 'Eat before you go' : 'Plan something after'}>
              <div className="space-y-2">
                {crossRecs.map(({ c, km }) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onSelectCrossRec(c)}
                    className="flex w-full items-center gap-3 rounded-xl bg-stone-50 p-2.5 text-left ring-1 ring-stone-200 transition hover:bg-white hover:ring-stone-300"
                  >
                    <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-stone-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photoUrlOrFallback(c)}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          const img = e.currentTarget
                          if (img.dataset.fallback) return
                          img.dataset.fallback = '1'
                          img.src = photoUrlOrFallback({ ...c, photo_url: null })
                        }}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-1 text-sm font-semibold text-stone-900">{c.name}</div>
                      <div className="line-clamp-1 text-xs text-stone-500">
                        {km.toFixed(1)} km away{c.address ? ` · ${c.address}` : ''}
                      </div>
                    </div>
                    <span aria-hidden="true" className="text-stone-400">›</span>
                  </button>
                ))}
              </div>
            </Section>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => onBook(card)}
              className="flex-1 rounded-xl bg-stone-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-stone-800 active:scale-[0.98]"
            >
              {primaryCta}
            </button>
            <a
              href={directionsUrl({ lat: card.lat, lng: card.lng, name: card.name, address: card.address })}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-stone-700 ring-1 ring-stone-300 transition hover:bg-stone-50 hover:text-stone-900 active:scale-[0.98]"
              aria-label={`Get directions to ${card.name}`}
            >
              Directions
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-bold tracking-[0.18em] text-stone-500">{title.toUpperCase()}</h3>
      {children}
    </div>
  )
}

function TagRow({ tags, emphasized }: { tags: string[]; emphasized: string[] }) {
  const empSet = new Set(emphasized)
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => {
        const hit = empSet.has(t)
        return (
          <span
            key={t}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
              hit
                ? 'bg-rose-50 text-rose-800 ring-rose-200'
                : 'bg-stone-50 text-stone-700 ring-stone-200'
            }`}
          >
            {humanise(t)}
          </span>
        )
      })}
    </div>
  )
}

function BadgeDetail({ badge, meta }: { badge: string; meta: Record<string, unknown> }) {
  if (badge === 'closing_soon' && typeof meta.ends_at === 'string') {
    const d = new Date(meta.ends_at)
    if (!Number.isNaN(d.getTime())) {
      return (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-900 ring-1 ring-rose-200">
          Pop-up ending {d.toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' })}
          {typeof meta.reason === 'string' && <> · {meta.reason}</>}
        </p>
      )
    }
  }
  if (badge === 'soft_launch' && typeof meta.opened === 'string') {
    const d = new Date(meta.opened)
    if (!Number.isNaN(d.getTime())) {
      return (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-900 ring-1 ring-emerald-200">
          Opened {d.toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      )
    }
  }
  if ((badge === 'critic_pick' || badge === 'award_fresh') && typeof meta.source === 'string') {
    return (
      <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
        {meta.source as string}
      </p>
    )
  }
  if (badge === 'award_fresh' && typeof meta.award === 'string') {
    return (
      <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
        {meta.award as string}
      </p>
    )
  }
  return null
}

function formatWindows(windows: HoursWindow[] | undefined): string {
  if (!windows || windows.length === 0) return 'Closed'
  return windows.map((w) => `${formatTime(w.open)} – ${formatTime(w.close)}`).join(', ')
}

function formatTime(hhmm: string): string {
  if (hhmm === '0000' || hhmm === '2400') return 'midnight'
  const h = parseInt(hhmm.slice(0, 2), 10)
  const m = hhmm.slice(2, 4)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return m === '00' ? `${hour12} ${period}` : `${hour12}:${m} ${period}`
}

function humanise(tag: string): string {
  return tag.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function todayDayKey(): DayKey {
  const map: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  return map[new Date().getDay()]
}
