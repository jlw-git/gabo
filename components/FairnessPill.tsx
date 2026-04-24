'use client'

import { useState } from 'react'
import { simulatedMrtEta } from '@/lib/planner/score'
import type { TransitMode } from '@/lib/planner/types'

type Props = {
  // Driving minutes as returned by the plan API. Transit minutes derived on
  // the fly via simulatedMrtEta when the user flips the local toggle.
  drivingEtaA: number
  drivingEtaB: number
  defaultMode: TransitMode
  plannerLabel?: string
  partnerLabel?: string
}

export function FairnessPill({
  drivingEtaA,
  drivingEtaB,
  defaultMode,
  plannerLabel = 'You',
  partnerLabel = 'Partner',
}: Props) {
  const [mode, setMode] = useState<TransitMode>(defaultMode)

  const etaA = mode === 'transit' ? simulatedMrtEta(drivingEtaA) : drivingEtaA
  const etaB = mode === 'transit' ? simulatedMrtEta(drivingEtaB) : drivingEtaB
  const icon = mode === 'transit' ? '🚆' : '🚗'

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-stone-50 px-3 py-2 text-xs ring-1 ring-stone-200">
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true">{icon}</span>
          <span className="text-stone-600">{plannerLabel}</span>
          <span className="font-semibold tabular-nums text-stone-900">{etaA} min</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true">{icon}</span>
          <span className="text-stone-600">{partnerLabel}</span>
          <span className="font-semibold tabular-nums text-stone-900">{etaB} min</span>
        </span>
      </div>
      <ModeToggle mode={mode} onChange={setMode} />
    </div>
  )
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
