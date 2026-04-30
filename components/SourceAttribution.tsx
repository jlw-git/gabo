import type { VenueSource } from '@/lib/planner/types'

type Props = {
  source?: VenueSource
  sourceUrl?: string | null
  className?: string
}

const LABELS: Record<VenueSource, string> = {
  google_places: 'via Google',
  foursquare: 'via Foursquare',
  bandsintown: 'via Bandsintown',
  sistic: 'via Sistic',
  museum: 'official venue page',
  editorial: 'editor’s pick',
  manual: '',
}

// Compact attribution chip. Per Google's & Foursquare's TOS we must show
// where data was sourced from; the editorial badge is our own honesty
// surface so users can tell hand-curated picks apart from API-fed rows.
export function SourceAttribution({ source, sourceUrl, className = '' }: Props) {
  if (!source || source === 'manual') return null
  const label = LABELS[source]
  if (!label) return null

  const inner = <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500">{label}</span>

  if (sourceUrl) {
    return (
      <a
        href={sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={`inline-flex items-center gap-1 hover:text-stone-700 hover:underline ${className}`}
      >
        {inner}
        <span aria-hidden="true" className="text-[10px] text-stone-400">↗</span>
      </a>
    )
  }
  return <span className={`inline-flex items-center gap-1 ${className}`}>{inner}</span>
}
