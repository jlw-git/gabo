'use client'

import { useEffect, useRef, useState } from 'react'

export type PlaceSelection = {
  label: string
  address: string
  lat: number
  lng: number
}

type Props = {
  id: string
  label: string
  placeholder?: string
  value: PlaceSelection | null
  onChange: (sel: PlaceSelection | null) => void
}

type Result = {
  id: string
  name: string
  address: string
  lat: number
  lng: number
}

const DEBOUNCE_MS = 250

export function PlaceSearchInput({ id, label, placeholder, value, onChange }: Props) {
  const [query, setQuery] = useState(value?.label ?? '')
  const [results, setResults] = useState<Result[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Close on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // Keep input text in sync when the caller clears the selection
  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) setQuery(value?.label ?? '')
    })
    return () => {
      cancelled = true
    }
  }, [value])

  useEffect(() => {
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  function runSearch(q: string) {
    if (abortRef.current) abortRef.current.abort()
    if (q.trim().length < 2) {
      setResults([])
      setLoading(false)
      return
    }
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    fetch(`/api/places/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((data) => {
        if (abortRef.current !== ctrl) return
        setResults(data.results ?? [])
        setHighlight(0)
      })
      .catch((err) => {
        if (err.name !== 'AbortError' && abortRef.current === ctrl) setResults([])
      })
      .finally(() => {
        if (abortRef.current === ctrl) setLoading(false)
      })
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value
    setQuery(q)
    setOpen(true)
    if (value) onChange(null) // user edited; invalidate previous selection
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => runSearch(q), DEBOUNCE_MS)
  }

  function pick(r: Result) {
    onChange({ label: r.name, address: r.address, lat: r.lat, lng: r.lng })
    setQuery(r.name)
    setOpen(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(results[highlight])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      {label && (
        <label htmlFor={id} className="mb-1 block text-xs font-medium uppercase tracking-wider text-stone-500">
          {label}
        </label>
      )}
      <input
        id={id}
        type="text"
        autoComplete="off"
        inputMode="search"
        placeholder={placeholder}
        value={query}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className="h-11 w-full rounded-xl bg-stone-50 px-3 text-sm ring-1 ring-stone-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-300"
      />

      {open && (loading || results.length > 0) && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-xl bg-white py-1 shadow-lg ring-1 ring-stone-200"
        >
          {loading && results.length === 0 && (
            <li className="px-3 py-2 text-sm text-stone-400">Searching…</li>
          )}
          {results.map((r, i) => (
            <li
              key={r.id}
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => {
                e.preventDefault() // keep focus
                pick(r)
              }}
              onMouseEnter={() => setHighlight(i)}
              className={`cursor-pointer px-3 py-2 text-sm ${
                i === highlight ? 'bg-rose-50' : 'hover:bg-stone-50'
              }`}
            >
              <div className="font-medium text-stone-900">{r.name}</div>
              {r.address && <div className="truncate text-xs text-stone-500">{r.address}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
