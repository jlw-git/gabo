'use client'

import type { DayKey, HoursWindow, PlanCard as PlanCardType, Profile, TransitMode } from '@/lib/planner/types'
import { grabRideUrl } from '@/lib/grab-ride'
import { FairnessPill } from './FairnessPill'
import { VenueMiniMap } from './VenueMiniMap'
import type { PlaceSelection } from './PlaceSearchInput'

type Props = {
  card: PlanCardType
  profile: Profile
  defaultMode: TransitMode
  startA?: PlaceSelection
  startB?: PlaceSelection
  onBook: (card: PlanCardType) => void
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

export function VenueDetailModal({
  card,
  profile,
  defaultMode,
  startA,
  startB,
  onBook,
  onClose,
}: Props) {
  const todayKey = todayDayKey()
  const badge = card.badge !== 'none' ? BADGE_COPY[card.badge] : null
  const budgetLabel = '$'.repeat(card.budget_band)
  const plannerLabel = profile.planner_name?.trim() || 'You'
  const partnerLabel = profile.partner_name?.trim() || 'Partner'

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-t-3xl bg-white shadow-xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative h-56 w-full bg-stone-100">
          {card.photo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={card.photo_url} alt={card.name} className="h-full w-full object-cover" />
          )}
          <button
            onClick={onClose}
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-stone-700 shadow backdrop-blur hover:bg-white"
            aria-label="Close"
          >
            ✕
          </button>
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
                <h2 className="text-2xl font-semibold tracking-tight">{card.name}</h2>
                {card.address && <p className="mt-0.5 text-sm text-stone-500">{card.address}</p>}
              </div>
              <span className="whitespace-nowrap rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-700">
                {budgetLabel}
              </span>
            </div>
          </div>

          <FairnessPill
            drivingEtaA={card.eta_a_min}
            drivingEtaB={card.eta_b_min}
            defaultMode={defaultMode}
            plannerLabel={plannerLabel}
            partnerLabel={partnerLabel}
          />

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

          <Section title="Cuisine">
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

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => onBook(card)}
              className="flex-1 rounded-xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-rose-700 active:scale-[0.98]"
            >
              Book
            </button>
            <a
              href={grabRideUrl({ lat: card.lat, lng: card.lng, name: card.name })}
              className="rounded-xl bg-[#00b14f] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#009a45] active:scale-[0.98]"
              aria-label={`Open Grab ride to ${card.name}`}
            >
              Grab ride
            </a>
          </div>
        </div>
      </div>
    </div>
  )
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
