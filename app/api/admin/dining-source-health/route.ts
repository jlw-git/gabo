// Diagnostic endpoint for the dining catalog providers.
//
// The full sync (/api/cron/sync-dining) runs 18 cuisine-specific queries
// and can take 90+ seconds. When Google Places or Foursquare credentials
// break (which they have — see CLAUDE.md §6.4), waiting for the cron to
// finish to learn that is wasteful. This endpoint hits each provider with
// a single known-good query and returns the per-provider state so the
// user can verify a GCP key fix or a Foursquare credit top-up in seconds.
//
// Gating: CRON_SECRET (same pattern as /api/admin/reseed). Not gated when
// CRON_SECRET is unset locally.
//
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     https://<host>/api/admin/dining-source-health

import { NextRequest } from 'next/server'
import {
  textSearch as googleTextSearch,
  GooglePlacesAuthError,
  GooglePlacesQuotaError,
} from '@/lib/sources/google-places'
import {
  searchPlaces as fsqSearchPlaces,
  FoursquareAuthError,
  FoursquareQuotaError,
} from '@/lib/sources/foursquare'

export const maxDuration = 30

const PROBE_QUERY = 'japanese restaurant singapore'

type ProviderHealth = {
  provider: 'google_places' | 'foursquare'
  ok: boolean
  // 'auth' = credentials rejected (403/401 + the provider-specific message).
  // 'quota' = key works but out of credits / quota (402/429).
  // 'unconfigured' = env var missing entirely (no credentials to test).
  // 'unknown' = something else (network, parsing, etc.).
  failure_kind?: 'auth' | 'quota' | 'unconfigured' | 'unknown'
  error_message?: string
  sample_result_name?: string
  elapsed_ms: number
}

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (expected) {
    const got = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (got !== expected) return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Run both probes in parallel — they don't share rate-limit pools.
  const [google, foursquare] = await Promise.all([probeGoogle(), probeFoursquare()])

  // 200 if AT LEAST ONE provider is healthy (the cron can fall back).
  // 503 if BOTH are down — that's the "dining catalog is degraded" state
  // CLAUDE.md §6.4 describes.
  const status = google.ok || foursquare.ok ? 200 : 503

  return Response.json(
    {
      checked_at: new Date().toISOString(),
      probe_query: PROBE_QUERY,
      providers: { google_places: google, foursquare },
      summary: status === 200 ? 'at least one provider healthy' : 'all providers down',
    },
    { status }
  )
}

export const POST = GET

async function probeGoogle(): Promise<ProviderHealth> {
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    return {
      provider: 'google_places',
      ok: false,
      failure_kind: 'unconfigured',
      error_message: 'GOOGLE_PLACES_API_KEY not set',
      elapsed_ms: 0,
    }
  }
  const started = Date.now()
  try {
    const results = await googleTextSearch(PROBE_QUERY, 1)
    return {
      provider: 'google_places',
      ok: results.length > 0,
      sample_result_name: results[0]?.name,
      error_message: results.length === 0 ? 'empty result set' : undefined,
      elapsed_ms: Date.now() - started,
    }
  } catch (err) {
    return classifyGoogle(err, Date.now() - started)
  }
}

async function probeFoursquare(): Promise<ProviderHealth> {
  if (!process.env.FOURSQUARE_API_KEY) {
    return {
      provider: 'foursquare',
      ok: false,
      failure_kind: 'unconfigured',
      error_message: 'FOURSQUARE_API_KEY not set',
      elapsed_ms: 0,
    }
  }
  const started = Date.now()
  try {
    const results = await fsqSearchPlaces(PROBE_QUERY, 1)
    return {
      provider: 'foursquare',
      ok: results.length > 0,
      sample_result_name: results[0]?.name,
      error_message: results.length === 0 ? 'empty result set' : undefined,
      elapsed_ms: Date.now() - started,
    }
  } catch (err) {
    return classifyFoursquare(err, Date.now() - started)
  }
}

function classifyGoogle(err: unknown, elapsed: number): ProviderHealth {
  const message = err instanceof Error ? err.message : String(err)
  let failure_kind: ProviderHealth['failure_kind'] = 'unknown'
  if (err instanceof GooglePlacesAuthError) failure_kind = 'auth'
  else if (err instanceof GooglePlacesQuotaError) failure_kind = 'quota'
  // Source files throw plain Error for some 4xx; sniff the message text so
  // operators get the right next step even if the typed class wasn't used.
  else if (/403|referrer|api_key/i.test(message)) failure_kind = 'auth'
  else if (/quota|429|over_query_limit/i.test(message)) failure_kind = 'quota'
  return { provider: 'google_places', ok: false, failure_kind, error_message: message, elapsed_ms: elapsed }
}

function classifyFoursquare(err: unknown, elapsed: number): ProviderHealth {
  const message = err instanceof Error ? err.message : String(err)
  let failure_kind: ProviderHealth['failure_kind'] = 'unknown'
  if (err instanceof FoursquareAuthError) failure_kind = 'auth'
  else if (err instanceof FoursquareQuotaError) failure_kind = 'quota'
  else if (/401/i.test(message)) failure_kind = 'auth'
  else if (/402|429|quota|credit/i.test(message)) failure_kind = 'quota'
  return { provider: 'foursquare', ok: false, failure_kind, error_message: message, elapsed_ms: elapsed }
}
