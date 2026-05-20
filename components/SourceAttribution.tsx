import type { VenueSource } from '@/lib/planner/types'

type Props = {
  source?: VenueSource
  sourceUrl?: string | null
  className?: string
}

const LABELS: Record<VenueSource, string> = {
  google_places: 'Google',
  foursquare: 'Foursquare',
  sistic: 'Sistic',
  museum: 'Official venue page',
  editorial: 'Editor’s pick',
  manual: '',
}

// Editorial rows come from a small known set of publications — show which one.
// Falls back to the generic "Editor's pick" if we don't recognise the host.
const EDITORIAL_HOSTS: Record<string, string> = {
  'sethlui.com': 'Seth Lui',
  'danielfooddiary.com': 'Daniel Food Diary',
  'misstamchiak.com': 'Miss Tam Chiak',
  'ladyironchef.com': 'Ladyironchef',
  'eatbook.sg': 'Eatbook',
  'thesmartlocal.com': 'The Smart Local',
  'esplanade.com': 'Esplanade',
}

function editorialLabelForUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return EDITORIAL_HOSTS[host] ?? null
  } catch {
    return null
  }
}

// Compact attribution chip. Per Google's & Foursquare's TOS we must show
// where data was sourced from; the editorial badge is our own honesty
// surface so users can tell hand-curated picks apart from API-fed rows.
export function SourceAttribution({ source, sourceUrl, className = '' }: Props) {
  if (!source || source === 'manual') return null
  const label =
    source === 'editorial' ? (editorialLabelForUrl(sourceUrl) ?? LABELS.editorial) : LABELS[source]
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
