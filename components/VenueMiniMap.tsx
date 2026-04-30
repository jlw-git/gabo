'use client'

import { useEffect, useRef, useState } from 'react'
import maplibregl, { Map as MlMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { LatLng } from '@/lib/planner/types'
import { osmStyle } from '@/lib/map-style'

type Props = {
  venue: { lat: number; lng: number; name: string }
  startA?: { point: LatLng; label: string }
  startB?: { point: LatLng; label: string }
}

const COLOR_VENUE = '#e11d48' // rose-600
const COLOR_A = '#0f766e' // teal-700
const COLOR_B = '#b45309' // amber-700

// Mini-map embedded in the venue detail modal. OSM raster tiles + pins for
// the venue and either partner's start point. Route overlays were dropped
// when the GrabMaps directions API became unavailable.
export function VenueMiniMap({ venue, startA, startB }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    let cancelled = false
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: osmStyle(),
      center: [venue.lng, venue.lat],
      zoom: 13,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    })
    mapRef.current = map

    map.on('error', (e) => {
      if (cancelled) return
      const msg = (e as { error?: Error }).error?.message ?? 'Map failed to load'
      setError(msg)
    })

    // Pins
    const venueEl = pinElement(COLOR_VENUE, '📍')
    new maplibregl.Marker({ element: venueEl, anchor: 'bottom' })
      .setLngLat([venue.lng, venue.lat])
      .setPopup(new maplibregl.Popup({ offset: 16, closeButton: false }).setText(venue.name))
      .addTo(map)

    if (startA) {
      new maplibregl.Marker({ element: pinElement(COLOR_A, 'A'), anchor: 'bottom' })
        .setLngLat([startA.point.lng, startA.point.lat])
        .setPopup(new maplibregl.Popup({ offset: 16, closeButton: false }).setText(startA.label))
        .addTo(map)
    }
    if (startB) {
      new maplibregl.Marker({ element: pinElement(COLOR_B, 'B'), anchor: 'bottom' })
        .setLngLat([startB.point.lng, startB.point.lat])
        .setPopup(new maplibregl.Popup({ offset: 16, closeButton: false }).setText(startB.label))
        .addTo(map)
    }

    // Fit bounds to include venue and any starts.
    const bounds = new maplibregl.LngLatBounds([venue.lng, venue.lat], [venue.lng, venue.lat])
    if (startA) bounds.extend([startA.point.lng, startA.point.lat])
    if (startB) bounds.extend([startB.point.lng, startB.point.lat])
    map.fitBounds(bounds, { padding: 56, duration: 0, maxZoom: 14 })

    return () => {
      cancelled = true
      map.remove()
      mapRef.current = null
    }
    // Only re-init if venue or start coords change meaningfully.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue.lat, venue.lng, startA?.point.lat, startA?.point.lng, startB?.point.lat, startB?.point.lng])

  return (
    <div className="relative h-44 w-full overflow-hidden rounded-xl ring-1 ring-stone-200">
      <div ref={containerRef} className="h-full w-full" />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-stone-50 p-3 text-center text-xs text-stone-500">
          Map unavailable · {error}
        </div>
      )}
      <div className="pointer-events-none absolute bottom-1.5 right-2 rounded bg-white/80 px-1.5 py-0.5 text-[9px] font-medium text-stone-500 backdrop-blur">
        © OpenStreetMap
      </div>
    </div>
  )
}

function pinElement(color: string, label: string): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = [
    `background:${color}`,
    'color:white',
    'width:26px',
    'height:26px',
    'border-radius:50%',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'font-size:12px',
    'font-weight:700',
    'box-shadow:0 2px 6px rgba(0,0,0,0.3)',
    'border:2px solid white',
  ].join(';')
  el.textContent = label
  return el
}
