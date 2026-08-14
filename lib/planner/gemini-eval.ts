// Gemini evaluation pass for plan results.
//
// After route scoring produces ranked candidates, this sends the top cards
// to Gemini Flash for a second-opinion evaluation. It returns a per-venue
// reasoning string that replaces the formula-generated body copy in PlanCard.
//
// Design constraints:
//   - Non-blocking: a 3-second timeout returns an empty map on slow responses.
//   - Single API call: all candidates batched into one generateContent request.
//   - Graceful fallback: caller continues with formula copy on any failure.
//   - No re-ranking: we trust the score formula; Gemini enriches, doesn't reorder.

import { chatComplete } from '@/lib/agents/provider'
import { COPY_MODEL } from '@/lib/agents/models'
import type { PlanCard, Profile } from './types'
import type { WeatherResult } from '@/lib/weather'

// 8s budget — flash-lite typically returns in 2–4s for a 10-candidate batch.
// 3s was too tight in practice (most plans timed out on real network).
const EVAL_TIMEOUT_MS = 8000
const MAX_CANDIDATES = 10 // top 5 dining + top 5 events

type EvalRow = { id: string; why: string }


function budgetLabel(band: number): string {
  return ['', '$', '$$', '$$$', '$$$$'][band] ?? '$$'
}

function formatEtas(a: number, b: number): string {
  if (a === 0 && b === 0) return 'no travel times'
  if (a === 0) return `${b} min from partner`
  if (b === 0) return `${a} min from you`
  return `${a} min from you, ${b} min from partner`
}

function buildPrompt(
  candidates: PlanCard[],
  profile: Profile,
  weather: WeatherResult,
  scheduledDate: Date,
  occasion: string | null
): string {
  const dateStr = scheduledDate.toLocaleDateString('en-SG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })

  const profileSummary = [
    profile.cuisines_loved.length ? `likes ${profile.cuisines_loved.join(', ')}` : null,
    profile.cuisines_avoided.length ? `avoids ${profile.cuisines_avoided.join(', ')}` : null,
    profile.vibe_defaults.length ? `wants ${profile.vibe_defaults.join('/')} vibe` : null,
    profile.budget_bands.length ? `budget ${profile.budget_bands.map(budgetLabel).join('/')}` : null,
  ]
    .filter(Boolean)
    .join('; ')

  const candidateLines = candidates
    .map((c) => {
      const parts: string[] = [
        `name: ${c.name}`,
        `type: ${c.bucket}`,
        `tags: ${[...c.cuisine_tags, ...c.vibe_tags].join(', ')}`,
        `price: ${budgetLabel(c.budget_band)}`,
        `travel: ${formatEtas(c.eta_a_min, c.eta_b_min)}`,
      ]
      if (c.is_outdoor) parts.push('outdoor')
      if (c.badge !== 'none') {
        const endsAt = c.badge_meta?.ends_at as string | undefined
        if (c.badge === 'closing_soon' && endsAt) {
          const d = new Date(endsAt)
          parts.push(`ends ${d.getDate()} ${d.toLocaleString('en-SG', { month: 'short' })}`)
        } else if (c.badge === 'soft_launch') {
          parts.push('newly opened')
        } else if (c.badge === 'critic_pick') {
          parts.push(`critic pick${c.badge_meta?.source ? ` (${c.badge_meta.source})` : ''}`)
        } else if (c.badge === 'award_fresh') {
          parts.push(c.badge_meta?.award ? String(c.badge_meta.award) : 'award-winning')
        }
      }
      if (c.trending_score >= 0.8) parts.push('trending')
      return `{ "id": "${c.id}", ${parts.map((p) => JSON.stringify(p)).join(', ')} }`
    })
    .join('\n')

  return `You are a Singapore date-night planner writing card body copy for a couples app.

Plan context:
- Date: ${dateStr}
- Weather: ${weather.condition}${occasion ? `\n- Occasion: ${occasion}` : ''}
- Couple profile: ${profileSummary || 'no preferences set'}

For each venue below, write ONE sentence of body copy — max 14 words, specific and concrete.
Mention the most distinguishing feature (cuisine style, end date, travel fairness, occasion fit).
Do NOT write "perfect for couples", "great atmosphere", or other generic filler.
If travel times are notably unequal (gap > 8 min), mention it.

Venues:
${candidateLines}

Return ONLY a raw JSON array, no markdown, no explanation:
[{ "id": "...", "why": "..." }, ...]`
}

async function callGemini(prompt: string): Promise<Map<string, string>> {
  const text = await chatComplete({
    model: COPY_MODEL,
    prompt,
    feature: 'plan-copy',
    timeoutMs: EVAL_TIMEOUT_MS,
  })
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return new Map()

  const parsed = JSON.parse(match[0]) as unknown
  if (!Array.isArray(parsed)) return new Map()

  const rows = parsed.filter(
    (r): r is EvalRow =>
      typeof r === 'object' &&
      r !== null &&
      typeof (r as Record<string, unknown>).id === 'string' &&
      typeof (r as Record<string, unknown>).why === 'string'
  )
  return new Map(rows.map((r) => [r.id, r.why]))
}

export async function evaluateCandidates(
  candidates: PlanCard[],
  profile: Profile,
  weather: WeatherResult,
  scheduledDate: Date,
  overrideTags: string[]
): Promise<Map<string, string>> {
  if (!process.env.GOOGLE_GEMINI_API_KEY) return new Map()
  if (candidates.length === 0) return new Map()

  const top = candidates.slice(0, MAX_CANDIDATES)
  const occasionTags = overrideTags.filter((t) => t === 'anniversary' || t === 'birthday')
  const occasion = occasionTags.length ? occasionTags.join(' + ') : null

  const prompt = buildPrompt(top, profile, weather, scheduledDate, occasion)

  return Promise.race([
    callGemini(prompt),
    new Promise<Map<string, string>>((resolve) =>
      setTimeout(() => resolve(new Map()), EVAL_TIMEOUT_MS)
    ),
  ]).catch(() => new Map<string, string>())
}
