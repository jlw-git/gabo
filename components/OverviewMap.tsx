'use client'

import { useEffect, useRef, useState } from 'react'
import maplibregl, { Map as MlMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { PlanCard as PlanCardType, TransitMode } from '@/lib/planner/types'
import { simulatedMrtEta } from '@/lib/planner/score'
import type { Buckets } from './ResultsView'
import type { PlaceSelection } from './PlaceSearchInput'

type Props = {
  buckets: Buckets
  startA: PlaceSelection
  startB: PlaceSelection
  plannerLabel: string
  partnerLabel: string
  mode: TransitMode
  onSelect: (card: PlanCardType) => void
}

const BUCKET_COLOR: Record<keyof Buckets, string> = {
  safe: '#10b981', // emerald-500
  stretch: '#f59e0b', // amber-500
  wild: '#e11d48', // rose-600
}

const START_A_COLOR = '#0f766e'
const START_B_COLOR = '#b45309'

// Birds-eye view of the 9 plan cards. Pins color-coded by bucket so fairness +
// freshness land geographically at a glance. Tapping a pin opens the same
// VenueDetailModal flow as the list view.
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
      style: 'https://maps.grab.com/api/style.json',
      // Tile fetches happen in a Web Worker with no base URL, so return an
      // absolute URL (not a relative path) from transformRequest.
      transformRequest: (url) => {
        if (url.startsWith('https://maps.grab.com/')) {
          const proxied = new URL(
            `/api/grabmaps/proxy?u=${encodeURIComponent(url)}`,
            window.location.origin
          ).toString()
          return { url: proxied }
        }
        return { url }
      },
      center: [103.8198, 1.3521],
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

    // Start-point pins
    new maplibregl.Marker({ element: dotElement(START_A_COLOR, 'A'), anchor: 'bottom' })
      .setLngLat([startA.lng, startA.lat])
      .setPopup(new maplibregl.Popup({ offset: 14, closeButton: false }).setText(`${plannerLabel} · ${startA.label}`))
      .addTo(map)
    new maplibregl.Marker({ element: dotElement(START_B_COLOR, 'B'), anchor: 'bottom' })
      .setLngLat([startB.lng, startB.lat])
      .setPopup(new maplibregl.Popup({ offset: 14, closeButton: false }).setText(`${partnerLabel} · ${startB.label}`))
      .addTo(map)

    // Venue pins, color-coded by bucket.
    const allCards: { card: PlanCardType; bucket: keyof Buckets }[] = [
      ...buckets.safe.map((c) => ({ card: c, bucket: 'safe' as const })),
      ...buckets.stretch.map((c) => ({ card: c, bucket: 'stretch' as const })),
      ...buckets.wild.map((c) => ({ card: c, bucket: 'wild' as const })),
    ]

    for (const { card, bucket } of allCards) {
      const el = venueElement(BUCKET_COLOR[bucket])
      el.addEventListener('click', (ev) => {
        ev.stopPropagation()
        onSelect(card)
      })
      const etaADisplay = displayEta(card.eta_a_min)
      const etaBDisplay = displayEta(card.eta_b_min)
      new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([card.lng, card.lat])
        .setPopup(
          new maplibregl.Popup({ offset: 16, closeButton: false }).setHTML(
            `<div style="font-weight:600">${escapeHtml(card.name)}</div>` +
              `<div style="font-size:11px;color:#57534e;margin-top:2px">${modeIcon} ${etaADisplay}m · ${etaBDisplay}m</div>`
          )
        )
        .addTo(map)
    }

    // Fit bounds to include all 11 points (2 starts + up to 9 venues).
    const bounds = new maplibregl.LngLatBounds([startA.lng, startA.lat], [startA.lng, startA.lat])
    bounds.extend([startB.lng, startB.lat])
    for (const { card } of allCards) bounds.extend([card.lng, card.lat])
    map.fitBounds(bounds, { padding: 72, duration: 0, maxZoom: 14 })

    return () => {
      map.remove()
      mapRef.current = null
    }
    // We intentionally re-init on any of these changes; re-mounting the map is
    // simpler than diffing pin sets for this count. Mode included so popups
    // re-render with the current transit mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buckets.safe, buckets.stretch, buckets.wild, startA.lat, startA.lng, startB.lat, startB.lng, mode])

  return (
    <div className="relative h-[65vh] w-full overflow-hidden rounded-2xl ring-1 ring-stone-200">
      <div ref={containerRef} className="h-full w-full" />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-stone-50 p-4 text-center text-sm text-stone-500">
          Map unavailable · {error}
        </div>
      )}
      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1 rounded-xl bg-white/90 px-3 py-2 text-[11px] font-medium text-stone-700 shadow-sm backdrop-blur">
        <LegendRow color={BUCKET_COLOR.safe} label="Easy yes" />
        <LegendRow color={BUCKET_COLOR.stretch} label="A small detour" />
        <LegendRow color={BUCKET_COLOR.wild} label="Worth the leap" />
      </div>
      <div className="pointer-events-none absolute bottom-1.5 right-2 rounded bg-white/80 px-1.5 py-0.5 text-[9px] font-medium text-stone-500 backdrop-blur">
        GrabMaps
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
  // Wrapper is positioned by MapLibre (translate). Inner dot handles the hover
  // scale so we never clobber MapLibre's transform.
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
  const el = document.createElement('div')
  el.style.cssText = [
    `background:${color}`,
    'color:white',
    'width:22px',
    'height:22px',
    'border-radius:50%',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'font-size:10px',
    'font-weight:700',
    'border:2px solid white',
    'box-shadow:0 2px 6px rgba(0,0,0,0.3)',
  ].join(';')
  el.textContent = label
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
