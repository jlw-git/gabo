'use client'

import { useEffect, useRef, useState } from 'react'
import maplibregl, { Map as MlMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { osmStyle } from '@/lib/map-style'
import type { Itinerary } from '@/lib/planner/itinerary'

type Props = {
  stops: Itinerary['stops']
  legs: Itinerary['legs']
}

const ROUTE_COLOR = '#e11d48' // rose-600

// Itinerary route map (F2): numbered stop pins + the route polyline (drive-route
// geometry per leg, straight-line fallback). Mirrors VenueMiniMap's setup.
export function ItineraryMiniMap({ stops, legs }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current || stops.length === 0) return
    let cancelled = false

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: osmStyle(),
      center: [stops[0].card.lng, stops[0].card.lat],
      zoom: 13,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    })
    mapRef.current = map

    map.on('error', (e) => {
      if (!cancelled) setError((e as { error?: Error }).error?.message ?? 'Map failed to load')
    })

    // Numbered pins for each stop.
    stops.forEach((s, i) => {
      new maplibregl.Marker({ element: numberedPin(i + 1), anchor: 'bottom' })
        .setLngLat([s.card.lng, s.card.lat])
        .setPopup(new maplibregl.Popup({ offset: 16, closeButton: false }).setText(s.card.name))
        .addTo(map)
    })

    // One LineString per leg: real drive geometry when present, else straight.
    const features: GeoJSON.Feature[] = legs.map((leg, i) => {
      const coords: number[][] =
        leg.path && leg.path.length > 1
          ? leg.path
          : [
              [stops[i].card.lng, stops[i].card.lat],
              [stops[i + 1].card.lng, stops[i + 1].card.lat],
            ]
      return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }
    })

    map.on('load', () => {
      if (cancelled || features.length === 0) return
      map.addSource('route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      })
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ROUTE_COLOR, 'line-width': 3, 'line-opacity': 0.7 },
      })
    })

    // Fit to all stops + any geometry.
    const bounds = new maplibregl.LngLatBounds(
      [stops[0].card.lng, stops[0].card.lat],
      [stops[0].card.lng, stops[0].card.lat]
    )
    stops.forEach((s) => bounds.extend([s.card.lng, s.card.lat]))
    legs.forEach((l) => l.path?.forEach((c) => bounds.extend(c as [number, number])))
    map.fitBounds(bounds, { padding: 48, duration: 0, maxZoom: 15 })

    return () => {
      cancelled = true
      map.remove()
      mapRef.current = null
    }
    // Re-init when the itinerary's stops change (e.g. switching evenings).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops.map((s) => s.card.id).join('|')])

  return (
    <div className="relative h-44 w-full overflow-hidden rounded-xl ring-1 ring-stone-200">
      <div ref={containerRef} className="h-full w-full" />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-stone-50 p-3 text-center text-xs text-stone-500">
          Map unavailable
        </div>
      )}
      <div className="pointer-events-none absolute bottom-1.5 right-2 rounded bg-white/80 px-1.5 py-0.5 text-[9px] font-medium text-stone-500 backdrop-blur">
        © OpenStreetMap
      </div>
    </div>
  )
}

function numberedPin(n: number): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = [
    'background:#e11d48',
    'color:white',
    'width:24px',
    'height:24px',
    'border-radius:50%',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'font-size:12px',
    'font-weight:700',
    'box-shadow:0 2px 6px rgba(0,0,0,0.3)',
    'border:2px solid white',
  ].join(';')
  el.textContent = String(n)
  return el
}
