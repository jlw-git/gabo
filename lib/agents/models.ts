// Central model registry for every LLM call in the app. One place to swap a
// model when pricing/quality shifts; one place to audit which task runs on which
// tier.
//
// PROVIDER SWAP: calls route through lib/agents/provider.ts. A bare id like
// 'gemini-2.5-flash' runs on direct Gemini (default) or, when OPENROUTER_API_KEY
// is set, the same model via OpenRouter. To move a task to another model/vendor,
// set its constant below to an OpenRouter slug — e.g.
//   export const ORCHESTRATION_MODEL = 'anthropic/claude-3.5-sonnet'
//   export const COPY_MODEL = 'openai/gpt-4o-mini'
// That's the whole change; the provider handles dispatch. (Grounded calls —
// museum discovery + grounded verifiers — stay on Gemini regardless, since
// Google Search grounding is Gemini-only.)
//
// Strategy (defaults):
//   - extraction tasks (blog posts → structured venues, museum site search →
//     exhibitions) use 'flash' for higher recall and stricter JSON adherence
//   - verification, copy, ranking, triage all use 'flash-lite' — they're
//     short single-turn calls where the cost difference matters and the
//     extra capability of flash doesn't pay off.

export const EXTRACTION_MODEL = 'gemini-2.5-flash'

export const VERIFIER_MODEL = 'gemini-2.5-flash-lite'
export const COPY_MODEL = 'gemini-2.5-flash-lite'
export const TRIAGE_MODEL = 'gemini-2.5-flash-lite'
export const RANKER_MODEL = 'gemini-2.5-flash-lite'

// Orchestration model for the conversational planner (F1) — the agentic/tool-
// calling path. DeepSeek V4 Pro, run via OpenRouter. A head-to-head on real
// refine inputs picked it over Kimi K2.6: equal-or-better tool-arg quality AND
// ~3-7s vs K2.6's ~8-40s (K2.6 timed out entirely on "fancier, anniversary").
// Kimi K2.6 is high-quality but too slow/variable for a synchronous refine.
// NOTE: OpenRouter-only slug — F1 REQUIRES OPENROUTER_API_KEY; without it the
// refine loop degrades gracefully (returns "couldn't adjust").
export const ORCHESTRATION_MODEL = 'deepseek/deepseek-v4-pro'

// Automatic fallback for OpenRouter calls (resilience when the primary model is
// unavailable / rate-limited). Applied via OpenRouter's `models` array, so a
// primary outage fails over with no extra code. Flash = fast + cheap backup.
// Empty string disables the fallback.
export const OPENROUTER_FALLBACK_MODEL = 'deepseek/deepseek-v4-flash'
