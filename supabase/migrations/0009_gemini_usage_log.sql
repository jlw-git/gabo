-- Per-LLM-call usage log for investigating Gemini/OpenRouter spend.
--
-- This table intentionally has no public policies. Server-side code writes and
-- reads it with the service-role key for the private /admin/agents dashboard.
-- Prompt previews are capped and redacted in application code before insert.

create table if not exists gemini_usage_log (
  id uuid primary key default gen_random_uuid(),
  feature text not null default 'unknown',
  provider text not null check (provider in ('gemini', 'openrouter')),
  model text not null,
  grounded boolean not null default false,
  tool_call_count int not null default 0,
  tool_calls jsonb not null default '[]'::jsonb,
  prompt_preview text not null default '',
  prompt_chars int not null default 0,
  output_chars int not null default 0,
  duration_ms int not null default 0,
  ok boolean not null default false,
  error_message text,
  route_path text,
  ip_hash text,
  user_agent_hash text,
  created_at timestamptz not null default now()
);

create index if not exists gemini_usage_log_created_idx
  on gemini_usage_log(created_at desc);

create index if not exists gemini_usage_log_feature_created_idx
  on gemini_usage_log(feature, created_at desc);

alter table gemini_usage_log enable row level security;

grant select, insert on gemini_usage_log to service_role;
