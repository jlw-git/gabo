'use client'

import { useEffect, useRef, useState } from 'react'
import maplibregl, { Map as MlMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { PlanCard as PlanCardType, TransitMode } from '@/lib/planner/types'
import { simulatedMrtEta } from '@/lib/planner/score'
import { osmStyle } from '@/lib/map-style'
import type { Buckets } from './ResultsView'
import type { PlaceSelection } from './PlaceSearchInput'

type Props = {
  buckets: Buckets
  startA: PlaceSelection | null
  startB: PlaceSelection | null
  plannerLabel: string
  partnerLabel: string
  mode: TransitMode
  onSelect: (card: PlanCardType) => void
}

const CATEGORY_COLOR: Record<'dining' | 'event', string> = {
  dining: '#e11d48', // rose-600
  event: '#7c3aed', // violet-600
}

const START_A_COLOR = '#0f766e'
const START_B_COLOR = '#b45309'
const SG_CENTER: [number, number] = [103.8198, 1.3521]

// Birds-eye map view. Pins color-coded by category (dining vs event). With
// start points provided, the map fits to include them; without, it centres on
// Singapore. Tap a pin → detail modal.
export function OverviewMap({
  buckets,
  startA,
  startB,
  plannerLabel,
  partnerLabel,
  mode,
  onSelect,
}: Props) {
  const displayEta = (drivingMin: number) =>
    mode === 'transit' ? simulatedMrtEta(drivingMin) : drivingMin
  const modeIcon = mode === 'transit' ? '🚆' : '🚗'
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: osmStyle(),
      center: SG_CENTER,
      zoom: 11,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    })
    mapRef.current = map

    map.on('error', (e) => {
      const msg = (e as { error?: Error }).error?.message ?? 'Map failed to load'
      setError(msg)
    })

    // Start-point pins (only when provided).
    if (startA) {
      new maplibregl.Marker({ element: dotElement(START_A_COLOR, 'A'), anchor: 'bottom' })
        .setLngLat([startA.lng, startA.lat])
        .setPopup(new maplibregl.Popup({ offset: 14, closeButton: false }).setText(`${plannerLabel} · ${startA.label}`))
        .addTo(map)
    }
    if (startB) {
      new maplibregl.Marker({ element: dotElement(START_B_COLOR, 'B'), anchor: 'bottom' })
        .setLngLat([startB.lng, startB.lat])
        .setPopup(new maplibregl.Popup({ offset: 14, closeButton: false }).setText(`${partnerLabel} · ${startB.label}`))
        .addTo(map)
    }

    // Venue pins coloured by category.
    const allCards: { card: PlanCardType; category: 'dining' | 'event' }[] = [
      ...buckets.dining.map((c) => ({ card: c, category: 'dining' as const })),
      ...buckets.events.map((c) => ({ card: c, category: 'event' as const })),
    ]

    for (const { card, category } of allCards) {
      const el = venueElement(CATEGORY_COLOR[category])
      el.addEventListener('click', (ev) => {
        ev.stopPropagation()
        onSelect(card)
      })
      const showEtas = card.eta_a_min > 0 || card.eta_b_min > 0
      const etaLine = showEtas
        ? `<div style="font-size:11px;color:#57534e;margin-top:2px">${modeIcon} ${displayEta(card.eta_a_min)}m${
            card.eta_b_min !== card.eta_a_min ? ` · ${displayEta(card.eta_b_min)}m` : ''
          }</div>`
        : ''
      new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([card.lng, card.lat])
        .setPopup(
          new maplibregl.Popup({ offset: 16, closeButton: false }).setHTML(
            `<div style="font-weight:600">${escapeHtml(card.name)}</div>${etaLine}`
          )
        )
        .addTo(map)
    }

    // Fit bounds to whatever points we have. With no points, leave the map
    // centred on Singapore at zoom 11.
    const points: [number, number][] = []
    if (startA) points.push([startA.lng, startA.lat])
    if (startB) points.push([startB.lng, startB.lat])
    for (const { card } of allCards) points.push([card.lng, card.lat])
    if (points.length >= 2) {
      const bounds = new maplibregl.LngLatBounds(points[0], points[0])
      for (const p of points) bounds.extend(p)
      map.fitBounds(bounds, { padding: 72, duration: 0, maxZoom: 14 })
    } else if (points.length === 1) {
      map.setCenter(points[0])
      map.setZoom(13)
    }

    return () => {
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buckets.dining, buckets.events, startA?.lat, startA?.lng, startB?.lat, startB?.lng, mode])

  return (
    <div className="relative h-[65vh] w-full overflow-hidden rounded-2xl ring-1 ring-stone-200">
      <div ref={containerRef} className="h-full w-full" />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-stone-50 p-4 text-center text-sm text-stone-500">
          Map unavailable · {error}
        </div>
      )}
      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1 rounded-xl bg-white/90 px-3 py-2 text-[11px] font-medium text-stone-700 shadow-sm backdrop-blur">
        <LegendRow color={CATEGORY_COLOR.dining} label="Dining" />
        <LegendRow color={CATEGORY_COLOR.event} label="Events" />
      </div>
      <div className="pointer-events-none absolute bottom-1.5 right-2 rounded bg-white/80 px-1.5 py-0.5 text-[9px] font-medium text-stone-500 backdrop-blur">
        © OpenStreetMap
      </div>
    </div>
  )
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="h-2.5 w-2.5 rounded-full"
        style={{ background: color, boxShadow: '0 0 0 2px white' }}
      />
      <span>{label}</span>
    </div>
  )
}

function venueElement(color: string): HTMLDivElement {
  // Wrapper positioned by MapLibre; inner dot handles hover scale so we never
  // clobber MapLibre's translate transform.
  const wrapper = document.createElement('div')
  wrapper.style.cssText = 'width:22px;height:22px;cursor:pointer'

  const dot = document.createElement('div')
  dot.style.cssText = [
    `background:${color}`,
    'width:100%',
    'height:100%',
    'border-radius:50%',
    'border:3px solid white',
    'box-shadow:0 2px 8px rgba(0,0,0,0.25)',
    'transition:transform 120ms ease',
    'transform-origin:center',
  ].join(';')
  wrapper.appendChild(dot)

  wrapper.addEventListener('mouseenter', () => {
    dot.style.transform = 'scale(1.2)'
  })
  wrapper.addEventListener('mouseleave', () => {
    dot.style.transform = 'scale(1)'
  })
  return wrapper
}

function dotElement(color: string, label: string): HTMLDivElement {
  // Start markers (You / Partner) — taller pin shape with letter inside, so
  // they read as a different category of marker from the venue dots. Anchored
  // at the bottom of the SVG so the tip sits on the exact lat/lng.
  const el = document.createElement('div')
  el.style.cssText = 'width:32px;height:40px;cursor:default;line-height:0'
  el.innerHTML = `
    <svg width="32" height="40" viewBox="0 0 32 40" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 1 C23.73 1 30 7.27 30 15 C30 25.5 16 38 16 38 C16 38 2 25.5 2 15 C2 7.27 8.27 1 16 1 Z"
            fill="${color}" stroke="white" stroke-width="2"
            style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.35))" />
      <text x="16" y="20" text-anchor="middle" fill="white"
            font-size="13" font-weight="700"
            font-family="system-ui, -apple-system, BlinkMacSystemFont, sans-serif">${label}</text>
    </svg>
  `
  return el
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
