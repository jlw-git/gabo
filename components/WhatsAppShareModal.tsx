'use client'

import { useMemo, useState } from 'react'
import type { PlanCard as PlanCardType, Profile } from '@/lib/planner/types'

type Props = {
  card: PlanCardType
  profile: Profile
  scheduledFor: Date
  onClose: () => void
}

export function WhatsAppShareModal({ card, profile, scheduledFor, onClose }: Props) {
  const partnerLabel = profile.partner_name?.trim() || 'Partner'

  const defaultText = useMemo(
    () => buildShareText(card, scheduledFor),
    [card, scheduledFor]
  )
  const [text, setText] = useState(defaultText)
  const [copied, setCopied] = useState(false)

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard unavailable in some sandboxed contexts */
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Send to {partnerLabel}</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600" aria-label="Close">
            ✕
          </button>
        </div>
        <p className="mb-4 text-sm text-stone-500">Edit the message below, then copy.</p>

        <label htmlFor="share-text" className="sr-only">
          Message
        </label>
        <textarea
          id="share-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          className="mb-4 w-full resize-none rounded-2xl bg-stone-50 p-4 text-sm leading-relaxed text-stone-800 ring-1 ring-stone-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-500"
        />

        <button
          onClick={copyText}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3.5 text-base font-semibold text-white transition hover:bg-emerald-700 active:scale-[0.99]"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

function buildShareText(card: PlanCardType, when: Date): string {
  const time = when.toLocaleString('en-SG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  const lines = [card.name, time]
  if (card.address) lines.push(card.address)
  lines.push(grabMapsUrl(card.lat, card.lng))
  return lines.join('\n')
}

function grabMapsUrl(lat: number, lng: number): string {
  // Link to GrabMaps consumer site centered on the venue. If Grab's URL
  // doesn't pin exactly, the map still opens around the right coordinates.
  return `https://maps.grab.com/?position=${lat},${lng}&zoom=17`
}
