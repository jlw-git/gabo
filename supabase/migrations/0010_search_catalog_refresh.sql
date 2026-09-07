-- Searches may request one shared catalogue refresh. Claiming consumes the daily
-- budget before work starts, including when a worker fails or disappears.
create table if not exists public.catalog_refresh_state (
  key text primary key check (key = 'catalogue'),
  next_attempt_at timestamptz not null default '-infinity',
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  lease_until timestamptz,
  lease_token uuid,
  status text not null default 'idle'
    check (status in ('idle', 'running', 'succeeded', 'failed')),
  summary jsonb,
  check (
    (status = 'running' and lease_until is not null and lease_token is not null)
    or (status <> 'running' and lease_until is null and lease_token is null)
  )
);

-- Existing catalogue freshness is unknown; the first search may claim a refresh.
-- Reapplying the migration must never reset an existing attempt's cooldown.
insert into public.catalog_refresh_state (key) values ('catalogue')
on conflict (key) do nothing;

alter table public.catalog_refresh_state enable row level security;
revoke all on public.catalog_refresh_state from public, anon, authenticated, service_role;
grant select on public.catalog_refresh_state to service_role;

create or replace function public.claim_catalog_refresh()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_token uuid;
begin
  -- The conditional UPDATE is the lock: concurrent callers recheck its predicate
  -- after the winning transaction commits. A missing state row fails closed.
  update public.catalog_refresh_state
  set last_attempt_at = v_now,
      next_attempt_at = v_now + interval '24 hours',
      lease_until = v_now + interval '5 minutes',
      lease_token = pg_catalog.gen_random_uuid(),
      status = 'running',
      summary = null
  where key = 'catalogue'
    and next_attempt_at <= v_now
    and (last_success_at is null or last_success_at <= v_now - interval '24 hours')
    and (lease_until is null or lease_until <= v_now)
  returning lease_token into v_token;

  return v_token;
end;
$$;

create or replace function public.finish_catalog_refresh(
  p_token uuid,
  p_succeeded boolean,
  p_summary jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_finished boolean := false;
begin
  if p_token is null or p_succeeded is null then
    return false;
  end if;

  -- Take the row lock before reading the clock so a delayed finisher cannot
  -- complete an expired lease after waiting for another transaction.
  perform 1 from public.catalog_refresh_state
  where key = 'catalogue' and lease_token = p_token and status = 'running'
  for update;
  if not found then
    return false;
  end if;

  v_now := pg_catalog.clock_timestamp();
  update public.catalog_refresh_state
  set last_success_at = case when p_succeeded then v_now else last_success_at end,
      next_attempt_at = case
        when p_succeeded then greatest(next_attempt_at, v_now + interval '24 hours')
        else next_attempt_at
      end,
      lease_until = null,
      lease_token = null,
      status = case when p_succeeded then 'succeeded' else 'failed' end,
      summary = coalesce(p_summary, '{}'::jsonb)
  where key = 'catalogue'
    and lease_token = p_token
    and status = 'running'
    and lease_until > v_now
  returning true into v_finished;

  return coalesce(v_finished, false);
end;
$$;

revoke all on function public.claim_catalog_refresh() from public, anon, authenticated;
revoke all on function public.finish_catalog_refresh(uuid, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.claim_catalog_refresh() to service_role;
grant execute on function public.finish_catalog_refresh(uuid, boolean, jsonb) to service_role;

comment on table public.catalog_refresh_state is
  'Global daily catalogue refresh budget and short worker lease. Change state through service-role RPCs only.';
comment on function public.claim_catalog_refresh() is
  'Atomically consume one refresh attempt per rolling 24 hours; return a five-minute lease token or null.';
comment on function public.finish_catalog_refresh(uuid, boolean, jsonb) is
  'Record an outcome only for the current unexpired lease. Failed attempts retain their cooldown.';

notify pgrst, 'reload schema';
