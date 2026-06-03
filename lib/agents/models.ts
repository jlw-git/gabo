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
// calling path. Kimi K2.6 is the standout for tool-calling, run via OpenRouter.
// NOTE: this is an OpenRouter-only slug, so F1 now REQUIRES OPENROUTER_API_KEY;
// without it the refine loop degrades gracefully (returns "couldn't adjust").
export const ORCHESTRATION_MODEL = 'moonshotai/kimi-k2.6'

// Automatic fallback for OpenRouter calls (resilience when the primary model is
// unavailable / rate-limited). Applied via OpenRouter's `models` array, so e.g.
// the Kimi orchestration call fails over to DeepSeek V4 without extra code.
// Empty string disables the fallback. ('deepseek/deepseek-v4-flash' for cheaper.)
export const OPENROUTER_FALLBACK_MODEL = 'deepseek/deepseek-v4-pro'
