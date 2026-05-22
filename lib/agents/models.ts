// Central model registry for every Gemini call in the app. One place to
// swap a model when pricing/quality shifts; one place to audit which task
// runs on which tier.
//
// Strategy (per the agentic-refactor plan):
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
