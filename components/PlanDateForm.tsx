'use client'

import { useState } from 'react'
import type { Override, Profile, VibeTag } from '@/lib/planner/types'
import { PlaceSearchInput, type PlaceSelection } from './PlaceSearchInput'
import { sgDateKey, sgHourMinute } from '@/lib/planner/sg-time'

export type PlanQualityPatch = Pick<
  Profile,
  'cuisines_loved' | 'cuisines_avoided' | 'vibe_defaults' | 'budget_bands'
>

type Props = {
  onSubmit: (payload: {
    start_a: { lat: number; lng: number } | null
    start_b: { lat: number; lng: number } | null
    scheduled_for: string
    override_tags: string[]
    startADetails: PlaceSelection | null
    startBDetails: PlaceSelection | null
    profilePatch: PlanQualityPatch
    // Optional free-text description. When set, the page handler runs the
    // triage agent (/api/plan/triage) to enrich profile / start points /
    // override_tags before calling /api/plan. Empty string means no triage.
    freeform: string
  }) => void
  disabled?: boolean
  defaultStartA?: PlaceSelection | null
  defaultStartB?: PlaceSelection | null
  plannerName?: string
  partnerName?: string
}

const OCCASION_CHIPS: { tag: Override; label: string }[] = [
  { tag: 'anniversary', label: 'Anniversary' },
  { tag: 'birthday', label: 'Birthday' },
]

const CUISINE_CHIPS = [
  { value: 'japanese', label: 'Japanese' },
  { value: 'italian', label: 'Italian' },
  { value: 'modern_european', label: 'Modern European' },
  { value: 'omakase', label: 'Omakase' },
  { value: 'cocktail', label: 'Cocktails' },
  { value: 'dessert', label: 'Dessert' },
  { value: 'cafe', label: 'Cafe' },
  { value: 'seafood', label: 'Seafood' },
]

const VIBE_CHIPS: { value: VibeTag; label: string }[] = [
  { value: 'cozy', label: 'Cozy' },
  { value: 'adventurous', label: 'Adventurous' },
  { value: 'celebratory', label: 'Celebratory' },
  { value: 'low_key', label: 'Low-key' },
]

const BUDGET_CHIPS = [
  { value: 1, label: '$' },
  { value: 2, label: '$$' },
  { value: 3, label: '$$$' },
  { value: 4, label: '$$$$' },
]

export function PlanDateForm({
  onSubmit,
  disabled,
  defaultStartA = null,
  defaultStartB = null,
  plannerName,
  partnerName,
}: Props) {
  const [youStart, setYouStart] = useState<PlaceSelection | null>(defaultStartA)
  const [partnerStart, setPartnerStart] = useState<PlaceSelection | null>(defaultStartB)
  const [time, setTime] = useState(defaultDateTime())
  const [occasion, setOccasion] = useState<Override[]>([])
  const [customOccasion, setCustomOccasion] = useState('')
  const [cuisines, setCuisines] = useState<string[]>([])
  const [vibes, setVibes] = useState<VibeTag[]>([])
  const [budgets, setBudgets] = useState<number[]>([])
  const [avoids, setAvoids] = useState('')
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [freeformOpen, setFreeformOpen] = useState(false)
  const [freeform, setFreeform] = useState('')

  const canSubmit = !!time

  function toggle(tag: Override) {
    setOccasion((cur) => (cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]))
  }

  function toggleList<T>(value: T, setList: React.Dispatch<React.SetStateAction<T[]>>) {
    setList((cur) => (cur.includes(value) ? cur.filter((item) => item !== value) : [...cur, value]))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || disabled) return
    const scheduled = new Date(`${time}:00+08:00`)
    if (!Number.isFinite(scheduled.getTime()) || scheduled.getTime() <= Date.now()) {
      setFormError('Choose an upcoming date and time in Singapore.')
      return
    }
    setFormError(null)
    const custom = customOccasion.trim()
    const override_tags: string[] = [...occasion, ...(custom ? [custom] : [])]
    const avoided = avoids
      .split(',')
      .map((item) => item.trim().toLowerCase().replace(/\s+/g, '_'))
      .filter(Boolean)
    onSubmit({
      start_a: youStart ? { lat: youStart.lat, lng: youStart.lng } : null,
      start_b: partnerStart ? { lat: partnerStart.lat, lng: partnerStart.lng } : null,
      scheduled_for: scheduled.toISOString(),
      override_tags,
      startADetails: youStart,
      startBDetails: partnerStart,
      profilePatch: {
        cuisines_loved: cuisines,
        cuisines_avoided: [...new Set(avoided)],
        vibe_defaults: vibes,
        budget_bands: budgets,
      },
      freeform: freeform.trim(),
    })
  }

  const youLabel = plannerName?.trim() ? `${plannerName}'s start` : "Your start"
  const partnerLabel = partnerName?.trim() ? `${partnerName}'s start` : 'Their start'

  return (
    <section id="planner" aria-labelledby="planner-title" className="grid scroll-mt-8 gap-7 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
      <header className="flex flex-col items-start pt-2 lg:pt-6">
        <p className="gabo-eyebrow">Your next date, sorted</p>
        <h1 id="planner-title" className="gabo-display mt-4 text-[2.8rem] leading-[1.06] tracking-[-0.045em] sm:text-6xl lg:text-[4.5rem]">
          Less planning.<br />
          <span className="text-brand">More us time.</span>
        </h1>
        <p className="mt-5 max-w-sm text-base leading-relaxed text-stone-600">
          Find dinner and something to do in Singapore, with your tastes and both journeys in mind.
        </p>
        <div className="mt-7 hidden w-full max-w-sm border-t border-stone-300/70 pt-6 lg:block">
          <p className="text-sm font-semibold">A little thought goes a long way.</p>
          <ul className="mt-4 space-y-4 text-sm text-stone-600">
            <li className="flex gap-3"><span className="text-brand" aria-hidden="true">01</span> Discover dinner spots and things to do.</li>
            <li className="flex gap-3"><span className="text-brand" aria-hidden="true">02</span> Compare the journey for each of you.</li>
            <li className="flex gap-3"><span className="text-brand" aria-hidden="true">03</span> Save a favourite. Share the idea.</li>
          </ul>
        </div>
        <p className="mt-6 text-xs text-stone-500 lg:mt-8">No account needed. Just a reason to go out.</p>
      </header>

      <form onSubmit={handleSubmit} className="gabo-planner min-w-0 rounded-[1.75rem] border border-stone-200 bg-white p-5 sm:p-7">
        <div className="mb-6 flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">Make time for two</h2>
          <span className="hidden rounded-full bg-[#f5f1ea] px-3 py-1.5 text-[11px] font-medium text-stone-600 sm:inline-flex">Dinner + things to do</span>
        </div>
        <Field label="When are you heading out?" hint="Singapore time" htmlFor="when">
          <input
            id="when"
            type="datetime-local"
            required
            value={time}
            onChange={(e) => { setTime(e.target.value); setFormError(null) }}
            aria-invalid={!!formError}
            aria-describedby={formError ? 'plan-error' : undefined}
            className="gabo-input h-12 w-full min-w-0 rounded-xl bg-stone-50 px-3 text-sm ring-1 ring-stone-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label={youLabel} hint="Optional" htmlFor="you-start">
            <PlaceSearchInput id="you-start" label="" placeholder="e.g. Raffles Place MRT" value={youStart} onChange={setYouStart} />
          </Field>
          <Field label={partnerLabel} hint="Optional" htmlFor="partner-start">
            <PlaceSearchInput id="partner-start" label="" placeholder="e.g. Jurong East MRT" value={partnerStart} onChange={setPartnerStart} />
          </Field>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-stone-500" aria-live="polite">
          {youStart && partnerStart
            ? 'Both starts added. We’ll weigh up the travel time for each of you.'
            : youStart || partnerStart
              ? 'One start added. Add the other to compare both journeys.'
              : 'Add both starts to compare journeys, or leave blank to explore islandwide.'}
        </p>

        <fieldset className="mt-6 border-t border-stone-100 pt-5">
          <legend className="sr-only">Your mood</legend>
          <p className="mb-3 text-sm font-medium">What’s the mood? <span className="font-normal text-stone-500">Optional</span></p>
          <div className="flex flex-wrap gap-2">
            <ChipButton selected={vibes.length === 0} onClick={() => setVibes([])}>Open to anything</ChipButton>
            {VIBE_CHIPS.map((chip) => (
              <ChipButton key={chip.value} selected={vibes.includes(chip.value)} onClick={() => toggleList(chip.value, setVibes)}>{chip.label}</ChipButton>
            ))}
          </div>
        </fieldset>

        <button type="button" onClick={() => setPreferencesOpen((o) => !o)} aria-expanded={preferencesOpen} aria-controls="plan-preferences" className="mt-4 flex min-h-11 w-full items-center justify-between gap-2 text-left text-sm font-medium text-stone-600 hover:text-brand">
          <span>Food preferences & budget{cuisines.length + budgets.length + (avoids.trim() ? 1 : 0) > 0 ? ' · added' : ''}</span>
          <span aria-hidden="true">{preferencesOpen ? '−' : '+'}</span>
        </button>
        <div id="plan-preferences" hidden={!preferencesOpen}>
          <fieldset className="mt-2">
            <legend className="mb-3 text-xs font-medium text-stone-600">Cuisines you enjoy</legend>
            <div className="flex flex-wrap gap-2">
              {CUISINE_CHIPS.map((chip) => (
                <ChipButton key={chip.value} selected={cuisines.includes(chip.value)} onClick={() => toggleList(chip.value, setCuisines)}>{chip.label}</ChipButton>
              ))}
            </div>
          </fieldset>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 sm:items-end">
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-stone-500">
                Dining price range
              </p>
              <div className="flex gap-2">
                {BUDGET_CHIPS.map((chip) => {
                  const on = budgets.includes(chip.value)
                  return (
                    <ChipButton
                      key={chip.value}
                      selected={on}
                      onClick={() => toggleList(chip.value, setBudgets)}
                    >
                      {chip.label}
                    </ChipButton>
                  )
                })}
              </div>
            </div>
            <label className="block">
              <span className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-stone-500">
                Cuisines to avoid
              </span>
              <input
                type="text"
                value={avoids}
                onChange={(e) => setAvoids(e.target.value)}
                placeholder="seafood, bar, omakase..."
                maxLength={90}
                className="h-10 w-full rounded-xl bg-stone-50 px-3 text-sm ring-1 ring-stone-200 placeholder:text-stone-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-300"
              />
            </label>
          </div>
          <button type="button" onClick={() => { setCuisines([]); setBudgets([]); setAvoids('') }} className="mt-2 min-h-11 text-xs font-medium text-stone-600 underline underline-offset-4">Clear food preferences</button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            className="min-h-11 rounded-full py-2 pr-3 text-xs font-medium text-stone-600 hover:text-brand"
            aria-expanded={moreOpen}
          >
            {moreOpen ? 'Hide occasion −' : 'Special occasion +'}
          </button>
          <button
            type="button"
            onClick={() => setFreeformOpen((o) => !o)}
            className="min-h-11 rounded-full py-2 pr-3 text-xs font-medium text-stone-600 hover:text-brand"
            aria-expanded={freeformOpen}
          >
            {freeformOpen ? 'Hide notes −' : 'Add a note +'}
          </button>
          {!moreOpen &&
            occasion.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-rose-200"
              >
                {OCCASION_CHIPS.find((c) => c.tag === tag)?.label ?? tag}
              </span>
            ))}
        </div>

        {moreOpen && (
          <div className="mt-3 space-y-2 border-t border-stone-100 pt-3">
            <div className="flex flex-wrap gap-2">
              {OCCASION_CHIPS.map((c) => {
                const on = occasion.includes(c.tag)
                return (
                  <button
                    type="button"
                    key={c.tag}
                    onClick={() => toggle(c.tag)}
                    aria-pressed={on}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition ${
                      on
                        ? 'bg-brand-soft text-brand-dark ring-brand/40'
                        : 'bg-white text-stone-700 ring-stone-200 hover:bg-stone-50'
                    }`}
                  >
                    {c.label}
                  </button>
                )
              })}
              <input
                type="text"
                aria-label="Other occasion"
                value={customOccasion}
                onChange={(e) => setCustomOccasion(e.target.value)}
                placeholder="Something else? proposal, reunion, first date…"
                maxLength={60}
                className="min-w-[180px] flex-1 rounded-full bg-stone-50 px-3 py-1.5 text-xs ring-1 ring-stone-200 placeholder:text-stone-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-300"
              />
            </div>
          </div>
        )}

        {freeformOpen && (
          <div className="mt-3 border-t border-stone-100 pt-3">
            <textarea
              aria-label="Notes for your date"
              value={freeform}
              onChange={(e) => setFreeform(e.target.value)}
              placeholder="Anniversary dinner near Marina Bay, my wife loves Italian, no seafood…"
              maxLength={600}
              rows={3}
              className="w-full resize-none rounded-xl bg-stone-50 px-3 py-2 text-sm ring-1 ring-stone-200 placeholder:text-stone-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-300"
            />
            <p className="mt-1.5 text-[11px] text-stone-400">
              Notes can add preferences to your search. Use the choices above for specific preferences.
            </p>
          </div>
        )}
        {formError && <p id="plan-error" role="alert" className="mt-3 text-sm text-red-700">{formError}</p>}
        <button type="submit" disabled={!canSubmit || disabled} className="mt-4 flex min-h-12 w-full items-center justify-between rounded-xl bg-brand px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-brand-dark active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-stone-300">
          <span>{disabled ? 'Finding your date spots…' : 'Find our date spots'}</span>
          <span aria-hidden="true">↗</span>
        </button>
        <p className="mt-3 text-center text-[11px] leading-relaxed text-stone-500">A shortlist to choose from. Book directly with the venue.</p>
      </form>
    </section>
  )
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={htmlFor} className="mb-2 flex flex-wrap items-baseline gap-1.5 text-xs font-medium text-stone-700">
          <span>{label}</span>
          {hint && <span className="text-[10px] font-normal normal-case tracking-normal text-stone-400">{hint}</span>}
        </label>
      )}
      {children}
    </div>
  )
}

function ChipButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-10 rounded-full px-3.5 py-2 text-xs font-medium ring-1 transition ${
        selected
          ? 'bg-brand-soft text-brand-dark ring-brand/40'
          : 'bg-white text-stone-700 ring-stone-200 hover:bg-stone-50'
      }`}
      aria-pressed={selected}
    >
      {children}
    </button>
  )
}

// The input and API payload always describe Singapore time, including abroad.
function defaultDateTime(): string {
  const now = new Date()
  const day = new Date(`${sgDateKey(now)}T00:00:00+08:00`)
  if (sgHourMinute(now).hour >= 18) day.setUTCDate(day.getUTCDate() + 1)
  return `${sgDateKey(day)}T19:30`
}
