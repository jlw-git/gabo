'use client'

import { useEffect, useRef, useState } from 'react'
import { simulatedMrtEta } from '@/lib/planner/score'
import type { LatLng, TransitMode } from '@/lib/planner/types'

type Props = {
  // Driving minutes from the plan API.
  drivingEtaA: number
  drivingEtaB: number
  defaultMode: TransitMode
  plannerLabel?: string
  partnerLabel?: string
  // Provide all three to enable real public-transit ETAs via /api/transit-eta.
  // Without them the transit toggle falls back to the legacy formula.
  venue?: LatLng
  startA?: LatLng | null
  startB?: LatLng | null
  scheduledFor?: Date
}

type TransitState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; etaA: number | null; etaB: number | null }
  | { kind: 'error' }

export function FairnessPill({
  drivingEtaA,
  drivingEtaB,
  defaultMode,
  plannerLabel = 'You',
  partnerLabel = 'Partner',
  venue,
  startA,
  startB,
  scheduledFor,
}: Props) {
  const [mode, setMode] = useState<TransitMode>(defaultMode)
  const [transit, setTransit] = useState<TransitState>({ kind: 'idle' })
  const fetchedRef = useRef(false)

  const canFetchTransit = Boolean(venue && scheduledFor && (startA || startB))

  useEffect(() => {
    if (mode !== 'transit' || !canFetchTransit || fetchedRef.current) return
    fetchedRef.current = true
    setTransit({ kind: 'loading' })

    const isoDate = scheduledFor!.toISOString()
    const jobs: Promise<number | null>[] = [
      startA ? requestTransit(startA, venue!, isoDate) : Promise.resolve(null),
      startB ? requestTransit(startB, venue!, isoDate) : Promise.resolve(null),
    ]

    Promise.all(jobs)
      .then(([a, b]) => setTransit({ kind: 'ready', etaA: a, etaB: b }))
      .catch(() => setTransit({ kind: 'error' }))
  }, [mode, canFetchTransit, startA, startB, venue, scheduledFor])

  const showSpinner = mode === 'transit' && transit.kind === 'loading'

  const etaA =
    mode === 'transit'
      ? transit.kind === 'ready' && transit.etaA !== null
        ? transit.etaA
        : simulatedMrtEta(drivingEtaA)
      : drivingEtaA
  const etaB =
    mode === 'transit'
      ? transit.kind === 'ready' && transit.etaB !== null
        ? transit.etaB
        : simulatedMrtEta(drivingEtaB)
      : drivingEtaB
  const icon = mode === 'transit' ? '🚆' : '🚗'

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-stone-50 px-3 py-2 text-xs ring-1 ring-stone-200">
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true">{icon}</span>
          <span className="text-stone-600">{plannerLabel}</span>
          <span className="font-semibold tabular-nums text-stone-900">
            {etaA} min{showSpinner && <Spinner />}
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true">{icon}</span>
          <span className="text-stone-600">{partnerLabel}</span>
          <span className="font-semibold tabular-nums text-stone-900">
            {etaB} min{showSpinner && <Spinner />}
          </span>
        </span>
      </div>
      <ModeToggle mode={mode} onChange={setMode} />
    </div>
  )
}

function Spinner() {
  return (
    <span
      className="ml-1 inline-block h-2.5 w-2.5 animate-spin rounded-full border border-stone-400 border-t-transparent align-middle"
      aria-hidden="true"
    />
  )
}

async function requestTransit(origin: LatLng, destination: LatLng, scheduledForIso: string): Promise<number | null> {
  try {
    const res = await fetch('/api/transit-eta', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin, destination, scheduled_for: scheduledForIso }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { duration_min?: number }
    return typeof data.duration_min === 'number' ? data.duration_min : null
  } catch {
    return null
  }
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: TransitMode
  onChange: (m: TransitMode) => void
}) {
  return (
    <div
      className="inline-flex rounded-full bg-stone-200/70 p-0.5"
      role="group"
      aria-label="Transit mode"
      onClick={(e) => e.stopPropagation()}
    >
      <ModeButton
        active={mode === 'drive'}
        onClick={() => onChange('drive')}
        icon="🚗"
        label="Show driving ETA"
      />
      <ModeButton
        active={mode === 'transit'}
        onClick={() => onChange('transit')}
        icon="🚆"
        label="Show transit ETA"
      />
    </div>
  )
}

function ModeButton({
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
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={`flex h-7 w-7 items-center justify-center rounded-full text-sm transition ${
        active ? 'bg-white shadow-sm ring-1 ring-stone-300' : 'text-stone-500 hover:text-stone-800'
      }`}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  )
}
