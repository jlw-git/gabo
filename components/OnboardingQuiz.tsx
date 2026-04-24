'use client'

import { useState } from 'react'
import type { Profile, VibeTag } from '@/lib/planner/types'

export type OnboardingResult = {
  profile: Profile
}

type Props = {
  onComplete: (result: OnboardingResult) => void
}

const CUISINES = [
  { value: 'japanese', label: 'Japanese' },
  { value: 'italian', label: 'Italian' },
  { value: 'chinese', label: 'Chinese' },
  { value: 'korean', label: 'Korean' },
  { value: 'thai', label: 'Thai' },
  { value: 'indian', label: 'Indian' },
  { value: 'middle_eastern', label: 'Middle Eastern' },
  { value: 'mediterranean', label: 'Mediterranean' },
  { value: 'spanish', label: 'Spanish' },
  { value: 'french', label: 'French' },
  { value: 'vietnamese', label: 'Vietnamese' },
  { value: 'peranakan', label: 'Peranakan' },
  { value: 'malay', label: 'Malay' },
  { value: 'modern_european', label: 'Modern European' },
  { value: 'american', label: 'American' },
  { value: 'mexican', label: 'Mexican' },
  { value: 'latin', label: 'Latin' },
]

const DIETARY = [
  { value: 'halal', label: 'Halal' },
  { value: 'vegetarian_friendly', label: 'Vegetarian' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'no_pork', label: 'No pork' },
  { value: 'no_beef', label: 'No beef' },
  { value: 'nut_allergy', label: 'Nut allergy' },
  { value: 'shellfish_allergy', label: 'Shellfish allergy' },
]

const VIBES: { value: VibeTag; label: string; hint: string }[] = [
  { value: 'cozy', label: 'Cozy', hint: 'Warm, low-key, quiet corners.' },
  { value: 'adventurous', label: 'Adventurous', hint: 'New cuisines, bold flavours.' },
  { value: 'celebratory', label: 'Celebratory', hint: 'Dress up, make it feel special.' },
  { value: 'low_key', label: 'Low-key', hint: 'Easy, comfortable, unfussy.' },
]

const BUDGETS = [
  { value: 1, label: '$', hint: 'Under $25 per person' },
  { value: 2, label: '$$', hint: '$25–50 per person' },
  { value: 3, label: '$$$', hint: '$50–100 per person' },
  { value: 4, label: '$$$$', hint: 'Over $100 per person' },
]

const TOTAL_STEPS = 4

export function OnboardingQuiz({ onComplete }: Props) {
  const [step, setStep] = useState(1)
  const [plannerName, setPlannerName] = useState('')
  const [partnerName, setPartnerName] = useState('')
  const [loved, setLoved] = useState<string[]>([])
  const [avoided, setAvoided] = useState<string[]>([])
  const [dietary, setDietary] = useState<string[]>([])
  const [vibes, setVibes] = useState<VibeTag[]>([])
  const [budgets, setBudgets] = useState<number[]>([])

  function toggleInList<T>(list: T[], setList: (v: T[]) => void, value: T) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])
  }

  function finish() {
    onComplete({
      profile: {
        planner_name: plannerName.trim() || 'You',
        partner_name: partnerName.trim() || 'Partner',
        cuisines_loved: loved,
        cuisines_avoided: avoided,
        dietary_hardstops: dietary,
        vibe_defaults: vibes,
        budget_bands: budgets,
        transit_pref: 'either',
      },
    })
  }

  function next() {
    if (step < TOTAL_STEPS) {
      setStep(step + 1)
    } else {
      finish()
    }
  }

  return (
    <div className="space-y-6">
      <ProgressBar step={step} total={TOTAL_STEPS} />

      {step === 1 && (
        <StepShell
          eyebrow="Step 1 of 4"
          title="Who’s planning?"
          subtitle="Optional — used on the plan card you share with your partner."
        >
          <div className="space-y-3">
            <TextField
              id="planner"
              label="Your name"
              value={plannerName}
              onChange={setPlannerName}
              placeholder="e.g. Alex"
              autoFocus
            />
            <TextField
              id="partner"
              label="Your partner’s name"
              value={partnerName}
              onChange={setPartnerName}
              placeholder="e.g. Sam"
            />
          </div>
        </StepShell>
      )}

      {step === 2 && (
        <StepShell
          eyebrow="Step 2 of 4"
          title="What do you both love to eat?"
          subtitle="Pick a few. We’ll lean toward these. Skip if you’re easy."
        >
          <ChipGrid
            options={CUISINES}
            selected={loved}
            onToggle={(v) => toggleInList(loved, setLoved, v)}
          />
        </StepShell>
      )}

      {step === 3 && (
        <StepShell
          eyebrow="Step 3 of 4"
          title="Anything to avoid?"
          subtitle="Cuisines you’d rather skip and any dietary needs. Add your own if the chips don’t cover it."
        >
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-stone-500">
                Cuisines to skip
              </p>
              <ChipGridWithCustom
                options={CUISINES}
                selected={avoided}
                onToggle={(v) => toggleInList(avoided, setAvoided, v)}
                onAddCustom={(v) => setAvoided([...avoided, v])}
                customPlaceholder="Other cuisine + Enter"
              />
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-stone-500">
                Dietary needs
              </p>
              <ChipGridWithCustom
                options={DIETARY}
                selected={dietary}
                onToggle={(v) => toggleInList(dietary, setDietary, v)}
                onAddCustom={(v) => setDietary([...dietary, v])}
                customPlaceholder="Other dietary need + Enter"
              />
            </div>
          </div>
        </StepShell>
      )}

      {step === 4 && (
        <StepShell
          eyebrow="Step 4 of 4"
          title="Moods and budgets you like."
          subtitle="Pick any number. We’ll weight recommendations across what you’ve chosen."
        >
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-stone-500">
                Go-to moods <span className="font-normal normal-case text-stone-400">· pick any</span>
              </p>
              <div className="grid grid-cols-2 gap-2">
                {VIBES.map((v) => {
                  const on = vibes.includes(v.value)
                  return (
                    <button
                      key={v.value}
                      type="button"
                      onClick={() => toggleInList(vibes, setVibes, v.value)}
                      className={`rounded-2xl p-3 text-left ring-1 transition ${
                        on
                          ? 'bg-rose-600 text-white ring-rose-600'
                          : 'bg-white text-stone-700 ring-stone-200 hover:bg-stone-50'
                      }`}
                    >
                      <div className="text-sm font-semibold">{v.label}</div>
                      <div className={`mt-0.5 text-xs ${on ? 'text-rose-100' : 'text-stone-500'}`}>
                        {v.hint}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-stone-500">
                Budget per person <span className="font-normal normal-case text-stone-400">· pick any</span>
              </p>
              <div className="grid grid-cols-4 gap-2">
                {BUDGETS.map((b) => {
                  const on = budgets.includes(b.value)
                  return (
                    <button
                      key={b.value}
                      type="button"
                      onClick={() => toggleInList(budgets, setBudgets, b.value)}
                      className={`rounded-xl p-2.5 ring-1 transition ${
                        on
                          ? 'bg-stone-900 text-white ring-stone-900'
                          : 'bg-white text-stone-700 ring-stone-200 hover:bg-stone-50'
                      }`}
                    >
                      <div className="text-sm font-semibold">{b.label}</div>
                      <div className={`mt-0.5 text-[10px] leading-tight ${on ? 'text-stone-300' : 'text-stone-500'}`}>
                        {b.hint}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </StepShell>
      )}

      <div className="flex items-center gap-3">
        {step > 1 && (
          <button
            type="button"
            onClick={() => setStep(step - 1)}
            className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50"
          >
            Back
          </button>
        )}
        <button
          type="button"
          onClick={next}
          className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-stone-500 ring-1 ring-stone-200 hover:bg-stone-50"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={next}
          className="flex-1 rounded-2xl bg-rose-600 px-4 py-3 text-base font-semibold text-white transition hover:bg-rose-700 active:scale-[0.99]"
        >
          {step === TOTAL_STEPS ? 'Start planning →' : 'Next'}
        </button>
      </div>
    </div>
  )
}

function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1 flex-1 rounded-full transition-colors ${
            i < step ? 'bg-rose-500' : 'bg-stone-200'
          }`}
        />
      ))}
    </div>
  )
}

function StepShell({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <p className="text-[11px] font-bold tracking-[0.18em] text-rose-600">{eyebrow}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-stone-500">{subtitle}</p>
      </header>
      {children}
    </div>
  )
}

function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium uppercase tracking-wider text-stone-500">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        maxLength={40}
        className="w-full rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-stone-200 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-rose-300"
      />
    </div>
  )
}

function ChipGrid({
  options,
  selected,
  onToggle,
}: {
  options: { value: string; label: string }[]
  selected: string[]
  onToggle: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o.value)
        return (
          <button
            type="button"
            key={o.value}
            onClick={() => onToggle(o.value)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition ${
              on
                ? 'bg-rose-600 text-white ring-rose-600'
                : 'bg-white text-stone-700 ring-stone-200 hover:bg-stone-50'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function ChipGridWithCustom({
  options,
  selected,
  onToggle,
  onAddCustom,
  customPlaceholder,
}: {
  options: { value: string; label: string }[]
  selected: string[]
  onToggle: (v: string) => void
  onAddCustom: (v: string) => void
  customPlaceholder?: string
}) {
  const [draft, setDraft] = useState('')
  const knownValues = new Set(options.map((o) => o.value))
  const customs = selected.filter((s) => !knownValues.has(s))

  function commit() {
    const v = draft.trim().toLowerCase().replace(/\s+/g, '_')
    if (!v) return
    if (!selected.includes(v)) onAddCustom(v)
    setDraft('')
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = selected.includes(o.value)
          return (
            <button
              type="button"
              key={o.value}
              onClick={() => onToggle(o.value)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition ${
                on
                  ? 'bg-rose-600 text-white ring-rose-600'
                  : 'bg-white text-stone-700 ring-stone-200 hover:bg-stone-50'
              }`}
            >
              {o.label}
            </button>
          )
        })}
        {customs.map((c) => (
          <button
            type="button"
            key={c}
            onClick={() => onToggle(c)}
            className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-3 py-1.5 text-sm font-medium text-white ring-1 ring-rose-600"
          >
            {c.replace(/_/g, ' ')}
            <span aria-hidden="true" className="text-rose-100">×</span>
          </button>
        ))}
      </div>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
        onBlur={commit}
        placeholder={customPlaceholder}
        maxLength={40}
        className="w-full rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-stone-200 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-rose-300"
      />
    </div>
  )
}
