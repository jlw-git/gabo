// Shared controlled vocabulary for every agent that emits structured
// preferences (triage, conversation/refine). Anything an LLM produces is
// filtered down to these sets post-parse so the planner only ever sees values
// it can actually filter/score on. Keep in sync with the form's chips.

import type { VibeTag } from '@/lib/planner/types'

export const CUISINE_VOCAB = [
  'japanese', 'korean', 'chinese', 'thai', 'vietnamese', 'indian', 'malay',
  'peranakan', 'italian', 'french', 'spanish', 'mediterranean', 'modern_european',
  'middle_eastern', 'mexican', 'american', 'cafe', 'cocktail', 'brunch',
  'dessert', 'bakery', 'seafood', 'omakase', 'pizza', 'bar',
] as const

export const VIBE_VOCAB: readonly VibeTag[] = ['cozy', 'adventurous', 'celebratory', 'low_key']

export const OVERRIDE_VOCAB = ['vegetarian', 'no_alcohol', 'anniversary', 'birthday'] as const

// Filter an arbitrary string list down to a controlled vocabulary, deduped.
export function filterToVocab<T extends readonly string[]>(
  values: string[],
  vocab: T
): T[number][] {
  const set = new Set<string>(vocab)
  return [...new Set(values.filter((v): v is T[number] => set.has(v)))]
}
