'use client'

import { useState } from 'react'
import type { Override, Profile, VibeTag } from '@/lib/planner/types'
import { PlaceSearchInput, type PlaceSelection } from './PlaceSearchInput'

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

const INTENT_PRESETS: {
  key: string
  label: string
  hint: string
  cuisines: string[]
  vibes: VibeTag[]
  budgets: number[]
}[] = [
  {
    key: 'dinner_event',
    label: 'Dinner + event',
    hint: 'Balanced shortlist for a whole evening.',
    cuisines: ['modern_european', 'cocktail'],
    vibes: ['celebratory', 'adventurous'],
    budgets: [],
  },
  {
    key: 'special_dinner',
    label: 'Special dinner',
    hint: 'Polished, reservation-worthy places.',
    cuisines: ['modern_european', 'french', 'omakase'],
    vibes: ['celebratory', 'cozy'],
    budgets: [3, 4],
  },
  {
    key: 'new_buzzy',
    label: 'New or buzzy',
    hint: 'Recent openings, pop-ups, critic picks.',
    cuisines: ['cocktail', 'bar', 'dessert'],
    vibes: ['adventurous', 'celebratory'],
    budgets: [],
  },
  {
    key: 'easy_quality',
    label: 'Easy but good',
    hint: 'Comfortable, lower-friction picks.',
    cuisines: ['japanese', 'italian', 'cafe'],
    vibes: ['cozy', 'low_key'],
    budgets: [2, 3],
  },
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
  const [intent, setIntent] = useState(INTENT_PRESETS[0].key)
  const [cuisines, setCuisines] = useState<string[]>([])
  const [vibes, setVibes] = useState<VibeTag[]>([])
  const [budgets, setBudgets] = useState<number[]>([])
  const [avoids, setAvoids] = useState('')
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
    if (!canSubmit) return
    const custom = customOccasion.trim()
    const override_tags: string[] = [...occasion, ...(custom ? [custom] : [])]
    const preset = INTENT_PRESETS.find((p) => p.key === intent) ?? INTENT_PRESETS[0]
    const avoided = avoids
      .split(',')
      .map((item) => item.trim().toLowerCase().replace(/\s+/g, '_'))
      .filter(Boolean)
    onSubmit({
      start_a: youStart ? { lat: youStart.lat, lng: youStart.lng } : null,
      start_b: partnerStart ? { lat: partnerStart.lat, lng: partnerStart.lng } : null,
      scheduled_for: new Date(time).toISOString(),
      override_tags,
      startADetails: youStart,
      startBDetails: partnerStart,
      profilePatch: {
        cuisines_loved: [...new Set([...preset.cuisines, ...cuisines])],
        cuisines_avoided: [...new Set(avoided)],
        vibe_defaults: [...new Set([...preset.vibes, ...vibes])],
        budget_bands: [...new Set([...preset.budgets, ...budgets])],
      },
      freeform: freeform.trim(),
    })
  }

  const youLabel = plannerName?.trim() ? `${plannerName}'s start` : "Your start"
  const partnerLabel = partnerName?.trim() ? `${partnerName}'s start` : 'Their start'

  return (
    <section className="space-y-8">
      <header className="space-y-3 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-600">Gabo</p>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl lg:text-5xl">
          When are you two heading out?
        </h1>
        <p className="mx-auto max-w-xl text-sm text-stone-500 md:text-base">
          Tell us when and where you&rsquo;re each starting from. We&rsquo;ll find date spots that work for both of you in 60 seconds.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="rounded-3xl bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)] ring-1 ring-stone-200 md:p-5"
      >
        <div className="grid gap-3 md:grid-cols-[minmax(180px,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end md:gap-2">
          <Field label="When">
            <input
              id="when"
              type="datetime-local"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="h-11 w-full rounded-xl bg-stone-50 px-3 text-sm ring-1 ring-stone-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-300"
            />
          </Field>

          <Field label={youLabel} hint="Optional">
            <PlaceSearchInput
              id="you-start"
              label=""
              placeholder="e.g. Raffles Place"
              value={youStart}
              onChange={setYouStart}
            />
          </Field>

          <Field label={partnerLabel} hint="Optional">
            <PlaceSearchInput
              id="partner-start"
              label=""
              placeholder="e.g. Jurong East MRT"
              value={partnerStart}
              onChange={setPartnerStart}
            />
          </Field>

          <button
            type="submit"
            disabled={!canSubmit || disabled}
            className="h-11 rounded-xl bg-stone-900 px-6 text-sm font-semibold text-white transition hover:bg-stone-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-stone-300 md:min-w-[120px]"
          >
            {disabled ? 'Finding…' : 'Plan it'}
          </button>
        </div>

        {youStart && partnerStart && (
          <p className="mt-3 text-xs text-stone-500">
            We&rsquo;ll favour spots roughly midway between you both.
          </p>
        )}

        <div className="mt-5 border-t border-stone-100 pt-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-stone-900">Quality brief</h2>
              <p className="text-xs text-stone-500">A few signals help Gabo rank the dining and event mix.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setIntent(INTENT_PRESETS[0].key)
                setCuisines([])
                setVibes([])
                setBudgets([])
                setAvoids('')
              }}
              className="self-start rounded-full px-2 py-1 text-xs font-medium text-stone-500 hover:text-stone-800 sm:self-auto"
            >
              Reset
            </button>
          </div>

          <div className="mt-3 grid gap-2 md:grid-cols-4">
            {INTENT_PRESETS.map((preset) => {
              const on = intent === preset.key
              return (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => setIntent(preset.key)}
                  className={`rounded-xl p-3 text-left ring-1 transition ${
                    on
                      ? 'bg-stone-900 text-white ring-stone-900'
                      : 'bg-stone-50 text-stone-700 ring-stone-200 hover:bg-white'
                  }`}
                  aria-pressed={on}
                >
                  <span className="block text-sm font-semibold">{preset.label}</span>
                  <span className={`mt-1 block text-xs leading-snug ${on ? 'text-stone-200' : 'text-stone-500'}`}>
                    {preset.hint}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-[1.15fr_1fr]">
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-stone-500">
                Dining priorities
              </p>
              <div className="flex flex-wrap gap-2">
                {CUISINE_CHIPS.map((chip) => {
                  const on = cuisines.includes(chip.value)
                  return (
                    <ChipButton
                      key={chip.value}
                      selected={on}
                      onClick={() => toggleList(chip.value, setCuisines)}
                    >
                      {chip.label}
                    </ChipButton>
                  )
                })}
              </div>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-stone-500">
                Mood
              </p>
              <div className="flex flex-wrap gap-2">
                {VIBE_CHIPS.map((chip) => {
                  const on = vibes.includes(chip.value)
                  return (
                    <ChipButton
                      key={chip.value}
                      selected={on}
                      onClick={() => toggleList(chip.value, setVibes)}
                    >
                      {chip.label}
                    </ChipButton>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(180px,0.55fr)_1fr] md:items-end">
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-stone-500">
                Budget comfort
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
                Avoid
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
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            className="rounded-full px-2 py-1 text-xs font-medium text-stone-500 hover:text-stone-800"
            aria-expanded={moreOpen}
          >
            {moreOpen ? 'Less options ▴' : 'Special occasion? ▾'}
          </button>
          <button
            type="button"
            onClick={() => setFreeformOpen((o) => !o)}
            className="rounded-full px-2 py-1 text-xs font-medium text-stone-500 hover:text-stone-800"
            aria-expanded={freeformOpen}
          >
            {freeformOpen ? 'Hide notes ▴' : 'Describe it in your own words ▾'}
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
                    className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition ${
                      on
                        ? 'bg-rose-50 text-rose-700 ring-rose-300'
                        : 'bg-white text-stone-700 ring-stone-200 hover:bg-stone-50'
                    }`}
                  >
                    {c.label}
                  </button>
                )
              })}
              <input
                type="text"
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
              value={freeform}
              onChange={(e) => setFreeform(e.target.value)}
              placeholder="Anniversary dinner near Marina Bay, my wife loves Italian, no seafood…"
              maxLength={600}
              rows={3}
              className="w-full resize-none rounded-xl bg-stone-50 px-3 py-2 text-sm ring-1 ring-stone-200 placeholder:text-stone-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-300"
            />
            <p className="mt-1.5 text-[11px] text-stone-400">
              We&rsquo;ll interpret this and pre-fill anything we can — your chips above always win.
            </p>
          </div>
        )}
      </form>
    </section>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      {label && (
        <label className="flex items-baseline gap-1.5 text-[11px] font-medium uppercase tracking-wider text-stone-500">
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
      className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition ${
        selected
          ? 'bg-rose-50 text-rose-700 ring-rose-300'
          : 'bg-white text-stone-700 ring-stone-200 hover:bg-stone-50'
      }`}
      aria-pressed={selected}
    >
      {children}
    </button>
  )
}

// Default to tonight at 19:30; if it's already past 18:00, default to tomorrow.
function defaultDateTime(): string {
  const d = new Date()
  if (d.getHours() >= 18) d.setDate(d.getDate() + 1)
  d.setHours(19, 30, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
