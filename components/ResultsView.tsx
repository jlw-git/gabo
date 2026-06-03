'use client'

import { useEffect, useMemo, useState } from 'react'
import type {
  PlanCard as PlanCardType,
  Profile,
  TransitMode,
} from '@/lib/planner/types'
import {
  hasClosingSoonLabel,
  hasJustOpenedLabel,
  isRecommended,
} from '@/lib/planner/badges'
import { bookingUrl } from '@/lib/booking-url'
import { loadShortlist, logShortlistEvent, saveShortlist } from '@/lib/shortlist-storage'
import { recordTasteEvent } from '@/lib/taste-memory'
import type { PlaceSelection } from './PlaceSearchInput'
import { PlanCard } from './PlanCard'
import { BookingOverlay } from './BookingOverlay'
import { WhatsAppShareModal } from './WhatsAppShareModal'
import { VenueDetailModal } from './VenueDetailModal'
import { OverviewMap } from './OverviewMap'
import { RefineBar, type ChatTurn, type RefineResult } from './RefineBar'
import { ItineraryView } from './ItineraryView'
import type { Itinerary } from '@/lib/planner/itinerary'
import type { PlanRequest } from '@/lib/planner/request-validation'

const ITINERARY_ENABLED = process.env.NEXT_PUBLIC_AGENTIC_ITINERARY_ENABLED === 'true'
const TASTE_ENABLED = process.env.NEXT_PUBLIC_AGENTIC_TASTE_ENABLED === 'true'

export type Buckets = {
  dining: PlanCardType[]
  events: PlanCardType[]
}

export type Diagnostics = {
  candidatesTotal: number
  afterLocalFilters: number
  relaxationAttempted: boolean
  startsProvided: 0 | 1 | 2
}

type Props = {
  buckets: Buckets
  profile: Profile
  scheduledFor: Date
  overrideTags: string[]
  startA: PlaceSelection | null
  startB: PlaceSelection | null
  weather?: { condition: 'clear' | 'rain'; text: string | null } | null
  outdoorExcluded?: number
  diagnostics?: Diagnostics
  onBack: () => void
  // Conversational refine (F1). Optional so non-refine callers still type-check;
  // RefineBar self-hides when the client flag is off.
  request?: PlanRequest
  chat?: ChatTurn[]
  onRefined?: (userMessage: string, result: RefineResult) => void
}

type Tab = 'dining' | 'events'
type Filter = 'all' | 'recommended' | 'limited' | 'new' | 'shortlist'

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'dining', label: 'Dining', icon: '🍽️' },
  { key: 'events', label: 'Events', icon: '🎟️' },
]

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'recommended', label: "Critics' picks" },
  { key: 'limited', label: 'Limited-run' },
  { key: 'new', label: 'Just opened' },
  { key: 'shortlist', label: '★ Shortlist' },
]

export function ResultsView({
  buckets,
  profile,
  scheduledFor,
  overrideTags,
  startA,
  startB,
  weather = null,
  outdoorExcluded = 0,
  diagnostics,
  onBack,
  request,
  chat = [],
  onRefined,
}: Props) {
  const [booking, setBooking] = useState<PlanCardType | null>(null)
  const [shared, setShared] = useState<PlanCardType | null>(null)
  const [details, setDetails] = useState<PlanCardType | null>(null)
  const [view, setView] = useState<'list' | 'map' | 'itinerary'>('list')
  // F2 itinerary: composed lazily the first time the user opens the view.
  const [itineraries, setItineraries] = useState<Itinerary[] | null>(null)
  const [itinLoading, setItinLoading] = useState(false)
  const [tab, setTab] = useState<Tab>('dining')
  const [filter, setFilter] = useState<Filter>('all')
  const [shortlist, setShortlist] = useState<Set<string>>(new Set())
  // F5: cards the user marked "Not for us" this session. Hidden from the list +
  // recorded as a negative taste signal. Session-scoped — a fresh plan starts
  // clean (the taste model carries the longitudinal memory).
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  // Transit-first by default — most SG date-night searches happen for people
  // taking the MRT, not driving. The profile.transit_pref signal is too weak
  // to override that (it's a one-off onboarding chip that few users revisit).
  const [mode, setMode] = useState<TransitMode>('transit')

  // Hydrate shortlist from localStorage once on mount.
  useEffect(() => {
    setShortlist(new Set(loadShortlist()))
  }, [])

  function toggleShortlist(card: PlanCardType) {
    setShortlist((prev) => {
      const next = new Set(prev)
      if (next.has(card.id)) {
        next.delete(card.id)
      } else {
        next.add(card.id)
        logShortlistEvent(card.id)
        // F5: feed the longitudinal taste memory (gated, client-only).
        if (TASTE_ENABLED) {
          recordTasteEvent(card.cuisine_tags, card.vibe_tags, 1)
        }
      }
      saveShortlist([...next])
      return next
    })
  }

  // F5: "Not for us" — hide the card and record a −1 taste event over its tags.
  // If the card was shortlisted, un-shortlist it (a skip contradicts a save).
  function skipCard(card: PlanCardType) {
    if (TASTE_ENABLED) {
      recordTasteEvent(card.cuisine_tags, card.vibe_tags, -1)
    }
    setSkipped((prev) => new Set(prev).add(card.id))
    setShortlist((prev) => {
      if (!prev.has(card.id)) return prev
      const next = new Set(prev)
      next.delete(card.id)
      saveShortlist([...next])
      return next
    })
  }

  // F2: switch to the itinerary view, composing on first open (lazy). The
  // composer reuses the buckets already on screen — no re-plan.
  async function openItinerary() {
    setView('itinerary')
    if (itineraries !== null || itinLoading) return
    setItinLoading(true)
    try {
      const res = await fetch('/api/plan/itinerary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dining: visibleDining,
          events: visibleEvents,
          scheduled_for: scheduledFor.toISOString(),
          mode,
        }),
      })
      const data = res.ok
        ? ((await res.json()) as { itineraries: Itinerary[] })
        : { itineraries: [] }
      setItineraries(data.itineraries ?? [])
    } catch (err) {
      console.error('itinerary compose failed', err)
      setItineraries([])
    } finally {
      setItinLoading(false)
    }
  }

  // Prefer the start-point name in the ETA pill — "Tampines MRT" / "Buona
  // Vista" reads more concretely than "You" / "Partner", and matches the map
  // labels the user just picked. Fall back to the user's name from onboarding
  // when no start point was provided, and finally to "You" / "Partner".
  // Use `||` (not `??`) so empty strings — which are what the auto-skipped
  // onboarding writes to planner_name / partner_name — also fall through.
  const plannerLabel = truncateLabel(startA?.label || profile.planner_name?.trim() || 'You')
  const partnerLabel = truncateLabel(startB?.label || profile.partner_name?.trim() || 'Partner')

  // F5: drop "Not for us" cards from every downstream view (lists, counts, map,
  // ETA toggle) so a skip removes the card everywhere at once.
  const visibleDining = useMemo(
    () => buckets.dining.filter((c) => !skipped.has(c.id)),
    [buckets.dining, skipped]
  )
  const visibleEvents = useMemo(
    () => buckets.events.filter((c) => !skipped.has(c.id)),
    [buckets.events, skipped]
  )

  const allCards = useMemo(
    () => [...visibleDining, ...visibleEvents],
    [visibleDining, visibleEvents]
  )
  const totalCards = allCards.length

  function confirmBooking(card: PlanCardType) {
    setBooking(null)
    setShared(card)
    window.open(bookingUrl(card), '_blank', 'noopener,noreferrer')
  }

  const tabCards = tab === 'dining' ? visibleDining : visibleEvents
  const activeCards = useMemo(() => applyFilter(tabCards, filter, shortlist), [tabCards, filter, shortlist])
  // Tab badges count only the cards that 'All' would surface — keeps the tab
  // pill count in sync with the chip below it, instead of showing a higher
  // raw-bucket number that no chip will ever match.
  const tabCounts = useMemo<Record<Tab, number>>(
    () => ({
      dining: applyFilter(visibleDining, 'all', shortlist).length,
      events: applyFilter(visibleEvents, 'all', shortlist).length,
    }),
    [visibleDining, visibleEvents, shortlist]
  )
  const filterCounts = useMemo<Record<Filter, number>>(
    () => ({
      all: applyFilter(tabCards, 'all', shortlist).length,
      recommended: tabCards.filter(isRecommended).length,
      limited: tabCards.filter(hasClosingSoonLabel).length,
      new: tabCards.filter(hasJustOpenedLabel).length,
      shortlist: tabCards.filter((c) => shortlist.has(c.id)).length,
    }),
    [tabCards, shortlist]
  )
  const showEtaToggle = useMemo(
    () => allCards.some((c) => c.eta_a_min > 0 || c.eta_b_min > 0),
    [allCards]
  )

  return (
    <div className="space-y-5">
      <header>
        <button onClick={onBack} className="text-sm text-stone-500 hover:text-stone-800">
          ← New search
        </button>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {totalCards === 0 ? 'Nothing fits this slot.' : 'Here’s what we found.'}
        </h1>
        <p className="text-sm text-stone-500">
          {scheduledFor.toLocaleString('en-SG', {
            weekday: 'long',
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          })}
          {startA && startB && ` · between ${plannerLabel} and ${partnerLabel}`}
          {startA && !startB && ` · from ${plannerLabel}`}
          {!startA && startB && ` · from ${partnerLabel}`}
          {!startA && !startB && ' · islandwide'}
        </p>
      </header>

      {request && onRefined && (
        <RefineBar request={request} chat={chat} onRefined={onRefined} />
      )}

      {weather?.condition === 'rain' && outdoorExcluded > 0 && (
        <div className="flex items-start gap-2 rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-900 ring-1 ring-sky-200">
          <span aria-hidden="true">🌧️</span>
          <p>
            Hiding {outdoorExcluded} outdoor {outdoorExcluded === 1 ? 'spot' : 'spots'} for this
            slot — NEA forecast: {weather.text ?? 'rain expected'}.
          </p>
        </div>
      )}

      {totalCards > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <CategoryTabs
                active={tab}
                onChange={setTab}
                counts={tabCounts}
              />
              {showEtaToggle && <EtaModeToggle mode={mode} onChange={setMode} />}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div
                className="inline-flex rounded-full bg-stone-100 p-1 ring-1 ring-stone-200"
                role="tablist"
                aria-label="Results view"
              >
                <ViewTab active={view === 'list'} onClick={() => setView('list')} label="List" />
                <ViewTab active={view === 'map'} onClick={() => setView('map')} label="Map" />
                {ITINERARY_ENABLED && (
                  <ViewTab
                    active={view === 'itinerary'}
                    onClick={openItinerary}
                    label="✨ Evening"
                  />
                )}
              </div>
            </div>
          </div>

          {view === 'list' && (
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {FILTERS.map((f) => {
                const on = f.key === filter
                const count = filterCounts[f.key]
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFilter(f.key)}
                    className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition ${
                      on
                        ? 'bg-stone-900 text-white ring-stone-900'
                        : 'bg-white text-stone-700 ring-stone-200 hover:bg-stone-50'
                    }`}
                  >
                    {f.label}
                    <span className={`ml-1.5 rounded-full px-1.5 text-[10px] ${on ? 'bg-white/20 text-white' : 'bg-rose-100 text-rose-700'}`}>
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      {totalCards === 0 && (
        <EmptyStateDiagnostic
          profile={profile}
          diagnostics={diagnostics}
          weather={weather}
          onBack={onBack}
        />
      )}

      {totalCards > 0 && view === 'map' && (
        <OverviewMap
          buckets={buckets}
          startA={startA}
          startB={startB}
          plannerLabel={plannerLabel}
          partnerLabel={partnerLabel}
          mode={mode}
          onSelect={(card) => setDetails(card)}
        />
      )}

      {totalCards > 0 &&
        view === 'itinerary' &&
        (itinLoading ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-white p-10 ring-1 ring-stone-200">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-rose-200 border-t-rose-600" />
            <p className="text-sm text-stone-600">Composing your evening…</p>
          </div>
        ) : (
          <ItineraryView
            itineraries={itineraries ?? []}
            onOpenDetails={(card) => setDetails(card)}
          />
        ))}

      {totalCards > 0 && view === 'list' && (
        <div>
          {activeCards.length === 0 ? (
            <FilterEmptyState
              tab={tab}
              filter={filter}
              otherTabHasContent={
                (tab === 'dining' ? visibleEvents.length : visibleDining.length) > 0
              }
              onClearFilter={() => setFilter('all')}
              onSwitchTab={() => setTab(tab === 'dining' ? 'events' : 'dining')}
            />
          ) : (
            <div className="space-y-3 md:grid md:grid-cols-2 md:gap-3 md:space-y-0 lg:grid-cols-3">
              {activeCards.map((c) => (
                <PlanCard
                  key={c.id}
                  card={c}
                  profile={profile}
                  defaultMode={mode}
                  mode={mode}
                  onModeChange={setMode}
                  plannerLabel={plannerLabel}
                  partnerLabel={partnerLabel}
                  shortlisted={shortlist.has(c.id)}
                  startA={startA ? { lat: startA.lat, lng: startA.lng } : null}
                  startB={startB ? { lat: startB.lat, lng: startB.lng } : null}
                  scheduledFor={scheduledFor}
                  onBook={(card) => setBooking(card)}
                  onOpenDetails={(card) => setDetails(card)}
                  onShare={(card) => setShared(card)}
                  onToggleShortlist={toggleShortlist}
                  onSkip={TASTE_ENABLED ? skipCard : undefined}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {booking && (
        <BookingOverlay
          card={booking}
          scheduledFor={scheduledFor}
          overrideTags={overrideTags}
          onConfirm={() => confirmBooking(booking)}
          onClose={() => setBooking(null)}
        />
      )}
      {shared && (
        <WhatsAppShareModal
          card={shared}
          profile={profile}
          scheduledFor={scheduledFor}
          onClose={() => setShared(null)}
        />
      )}
      {details && (
        <VenueDetailModal
          card={details}
          profile={profile}
          defaultMode={mode}
          startA={startA ?? undefined}
          startB={startB ?? undefined}
          scheduledFor={scheduledFor}
          allCards={allCards}
          shortlisted={shortlist.has(details.id)}
          onSelectCrossRec={(card) => setDetails(card)}
          onBook={(card) => {
            setDetails(null)
            setBooking(card)
          }}
          onShare={(card) => setShared(card)}
          onToggleShortlist={toggleShortlist}
          onClose={() => setDetails(null)}
        />
      )}
    </div>
  )
}

// Empty-state copy is driven by the meta the planner already returns, not
// by a static checklist. We pick the most-likely culprit from the drop
// ratio across hard filters, then offer the matching specific fix instead
// of the old generic "try X, Y, Z" list.
function EmptyStateDiagnostic({
  profile,
  diagnostics,
  weather,
  onBack,
}: {
  profile: Profile
  diagnostics?: Diagnostics
  weather: { condition: 'clear' | 'rain'; text: string | null } | null
  onBack: () => void
}) {
  const total = diagnostics?.candidatesTotal ?? 0
  const survived = diagnostics?.afterLocalFilters ?? 0
  const dropped = Math.max(0, total - survived)
  const hasBudget = profile.budget_bands.length > 0
  const hasDietary = profile.dietary_hardstops.length > 0
  const hasAvoid = profile.cuisines_avoided.length > 0
  const relaxed = diagnostics?.relaxationAttempted ?? false
  const startsProvided = diagnostics?.startsProvided ?? 0

  // Heuristic: pick the single most-actionable hint to lead with. Order
  // matters — narrow data issues first, then constraints, then geography,
  // then the catch-all.
  let headline = 'Nothing matched your slot.'
  let body = "Try a different evening — Singapore's catalog is thinnest at off-hours."
  let primaryAction: { label: string; subtle?: boolean } | null = null

  if (total === 0) {
    headline = 'No venues loaded for this search.'
    body = 'The catalog returned zero rows. This usually means a service is down — try again in a minute, or refresh the page.'
  } else if (total < 30) {
    headline = 'Catalog is unusually thin right now.'
    body = `Only ${total} active venues in the catalog for this search. The data sync may be running behind — try again later.`
  } else if (survived === 0 && hasDietary) {
    headline = `We don't yet have ${profile.dietary_hardstops.join(', ')} coverage in the catalog.`
    body = `${total} venues are open for this slot, but none are tagged with your dietary requirement. We're still backfilling that signal across the catalog.`
    primaryAction = { label: 'Remove dietary filter in profile' }
  } else if (relaxed) {
    headline = 'We widened the search but still came up short.'
    body = `Out of ${total} venues, ${survived} fit your slot and filters — but none reached the tabs after widening. Try a different evening or remove a start point.`
  } else if (dropped > 0 && survived > 0 && startsProvided === 2) {
    headline = `${survived} ${survived === 1 ? 'venue fits' : 'venues fit'} your slot — but none are reachable from both start points within 60 min.`
    body = 'Drop one start point to search from a single origin, or pick a slot closer to the city centre.'
  } else if (dropped > 0 && survived > 0) {
    headline = `${survived} ${survived === 1 ? 'venue passed' : 'venues passed'} your filters — but none scored highly enough to show.`
    body = 'Try a slightly different time, or loosen filters in your profile.'
  } else if (dropped > total * 0.8 && (hasBudget || hasAvoid)) {
    const culprits: string[] = []
    if (hasBudget) culprits.push('budget')
    if (hasAvoid) culprits.push('avoid list')
    headline = `Most venues were ruled out by your ${culprits.join(' and ')}.`
    body = `Out of ${total} active venues, only ${survived} survived your filters. Loosening one usually opens things up.`
    primaryAction = { label: 'Edit profile' }
  } else if (weather?.condition === 'rain') {
    headline = 'Rain expected — outdoor spots are hidden.'
    body = "Try an indoor-focused slot or pick a clearer evening."
  }

  return (
    <div className="rounded-2xl bg-white p-6 ring-1 ring-stone-200">
      <h3 className="text-base font-semibold tracking-tight">{headline}</h3>
      <p className="mt-1 text-sm text-stone-600">{body}</p>
      {diagnostics && total > 0 && (
        <p className="mt-3 text-xs text-stone-400">
          Catalog: {total} active · {survived} fit your slot
          {relaxed && ' · we tried widening the search'}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-800"
        >
          {primaryAction?.label ?? 'Edit search'}
        </button>
      </div>
    </div>
  )
}

function applyFilter(cards: PlanCardType[], filter: Filter, shortlist: Set<string>): PlanCardType[] {
  switch (filter) {
    case 'all':
      return cards.filter(
        (c) => isRecommended(c) || hasClosingSoonLabel(c) || hasJustOpenedLabel(c),
      )
    case 'recommended':
      return cards.filter(isRecommended)
    case 'limited':
      return cards.filter(hasClosingSoonLabel)
    case 'new':
      return cards.filter(hasJustOpenedLabel)
    case 'shortlist':
      return cards.filter((c) => shortlist.has(c.id))
  }
}

function emptyHeadlineForFilter(tab: Tab, filter: Filter): { headline: string; body: string } {
  if (filter === 'shortlist') {
    return {
      headline: 'Nothing saved yet.',
      body: 'Tap the ☆ on any card to keep it here for later.',
    }
  }
  if (filter === 'limited') {
    return {
      headline: 'No limited-run picks for this slot.',
      body: 'Closing-soon pop-ups in this category aren’t open at this time.',
    }
  }
  if (filter === 'new') {
    return {
      headline: 'No just-opened picks for this slot.',
      body: 'Recently-opened spots in this category aren’t open at this time.',
    }
  }
  if (filter === 'recommended') {
    return {
      headline: 'No critic or award picks for this slot.',
      body: 'Try “All” to see every option, or switch tabs.',
    }
  }
  return tab === 'dining'
    ? {
        headline: 'No dining at this time.',
        body: 'Try the Events tab, or pick a slightly different time.',
      }
    : {
        headline: 'No events at this time.',
        body: 'Try the Dining tab, or pick another evening.',
      }
}

function FilterEmptyState({
  tab,
  filter,
  otherTabHasContent,
  onClearFilter,
  onSwitchTab,
}: {
  tab: Tab
  filter: Filter
  otherTabHasContent: boolean
  onClearFilter: () => void
  onSwitchTab: () => void
}) {
  const { headline, body } = emptyHeadlineForFilter(tab, filter)
  const otherTabLabel = tab === 'dining' ? 'Events' : 'Dining'
  return (
    <div className="rounded-2xl bg-white p-5 ring-1 ring-stone-200">
      <h3 className="text-sm font-semibold tracking-tight text-stone-900">{headline}</h3>
      <p className="mt-1 text-sm text-stone-600">{body}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {filter !== 'all' && (
          <button
            type="button"
            onClick={onClearFilter}
            className="rounded-full bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-stone-800"
          >
            Show all in this tab
          </button>
        )}
        {otherTabHasContent && (
          <button
            type="button"
            onClick={onSwitchTab}
            className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50"
          >
            Switch to {otherTabLabel}
          </button>
        )}
      </div>
    </div>
  )
}

function CategoryTabs({
  active,
  onChange,
  counts,
}: {
  active: Tab
  onChange: (t: Tab) => void
  counts: Record<Tab, number>
}) {
  return (
    <div
      role="tablist"
      aria-label="Result category"
      className="inline-flex rounded-full bg-stone-100 p-1 ring-1 ring-stone-200"
    >
      {TABS.map((t) => {
        const on = t.key === active
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition ${
              on
                ? 'bg-white text-stone-900 shadow-sm ring-1 ring-stone-200'
                : 'text-stone-500 hover:text-stone-800'
            }`}
          >
            <span aria-hidden="true">{t.icon}</span>
            <span>{t.label}</span>
            <span
              className={`ml-1 rounded-full px-1.5 text-[10px] font-bold ${
                on ? 'bg-rose-100 text-rose-700' : 'bg-stone-200 text-stone-600'
              }`}
            >
              {counts[t.key]}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function EtaModeToggle({
  mode,
  onChange,
}: {
  mode: TransitMode
  onChange: (m: TransitMode) => void
}) {
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 p-1 pl-2.5 ring-1 ring-stone-200"
      role="group"
      aria-label="ETA transport mode"
    >
      <span className="text-[11px] font-semibold text-stone-500">Times</span>
      <div className="inline-flex rounded-full bg-stone-200/70 p-0.5">
        <EtaModeButton
          active={mode === 'drive'}
          onClick={() => onChange('drive')}
          icon="🚗"
          label="Show driving ETA for all cards"
        />
        <EtaModeButton
          active={mode === 'transit'}
          onClick={() => onChange('transit')}
          icon="🚆"
          label="Show transit ETA for all cards"
        />
      </div>
    </div>
  )
}

function EtaModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: string
  label: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-6 w-7 items-center justify-center rounded-full text-sm transition ${
        active ? 'bg-white shadow-sm ring-1 ring-stone-300' : 'text-stone-500 hover:text-stone-800'
      }`}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  )
}

function ViewTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
        active ? 'bg-white text-stone-900 shadow-sm ring-1 ring-stone-200' : 'text-stone-500 hover:text-stone-800'
      }`}
    >
      {label}
    </button>
  )
}

// Keep ETA-pill labels readable on narrow cards — anything longer than this
// runs into the minute count. SG place names from OneMap are often verbose
// ("MARINA BAY FINANCIAL CENTRE TOWER 3"); truncate to a single token-ish
// length with an ellipsis.
function truncateLabel(s: string, max = 18): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1).trimEnd()}…`
}
