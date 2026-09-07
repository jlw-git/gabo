-- Recommended: node scripts/test-search-refresh-db.mjs creates and cleans up
-- an isolated database and also tests 32 concurrent claim transactions.
-- Run this SQL directly only against a disposable PostgreSQL database with Supabase's anon,
-- authenticated and service_role roles and migration 0010 already installed:
-- psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/test-search-refresh-db.sql
-- The test service_role must have BYPASSRLS, matching the Supabase role.
-- Fixtures are rolled back. Concurrency requires separate database connections.
\set ON_ERROR_STOP on
begin;

update public.catalog_refresh_state
set next_attempt_at = '-infinity', last_attempt_at = null, last_success_at = null,
    lease_until = null, lease_token = null, status = 'idle', summary = null;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(v_role, 'public.catalog_refresh_state', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      or has_function_privilege(v_role, 'public.claim_catalog_refresh()', 'EXECUTE')
      or has_function_privilege(v_role, 'public.finish_catalog_refresh(uuid,boolean,jsonb)', 'EXECUTE') then
      raise exception 'Unexpected public access for %', v_role;
    end if;
  end loop;
  if has_table_privilege('service_role', 'public.catalog_refresh_state', 'INSERT,UPDATE,DELETE,TRUNCATE') then
    raise exception 'Service role can bypass the atomic RPC';
  end if;
end;
$$;

set local role service_role;
do $$
declare
  v_token uuid;
  v_state public.catalog_refresh_state%rowtype;
begin
  v_token := public.claim_catalog_refresh();
  if v_token is null then raise exception 'Initial claim failed'; end if;
  select * into strict v_state from public.catalog_refresh_state;
  if v_state.status <> 'running' or v_state.lease_token <> v_token
    or v_state.next_attempt_at - v_state.last_attempt_at <> interval '24 hours'
    or v_state.lease_until - v_state.last_attempt_at <> interval '5 minutes' then
    raise exception 'Claim did not atomically consume the daily budget and acquire a lease';
  end if;
  if public.claim_catalog_refresh() is not null then raise exception 'Duplicate claim allowed'; end if;
  if public.finish_catalog_refresh(gen_random_uuid(), true, '{}')
    or public.finish_catalog_refresh(null, true, '{}')
    or public.finish_catalog_refresh(v_token, null, '{}') then
    raise exception 'Invalid completion accepted';
  end if;
  if not public.finish_catalog_refresh(v_token, false, '{"reason":"test failure"}') then
    raise exception 'Failure completion rejected';
  end if;
  if public.claim_catalog_refresh() is not null then raise exception 'Failed attempt was retried within 24 hours'; end if;
  if public.finish_catalog_refresh(v_token, true, '{}') then raise exception 'Completed lease was reusable'; end if;
  select * into strict v_state from public.catalog_refresh_state;
  if v_state.status <> 'failed' or v_state.last_success_at is not null
    or v_state.lease_token is not null or v_state.lease_until is not null
    or v_state.summary->>'reason' <> 'test failure'
    or v_state.next_attempt_at - v_state.last_attempt_at <> interval '24 hours' then
    raise exception 'Failure erased the cooldown or marked success';
  end if;
end;
$$;
reset role;

-- Advance the fixture into the next day and allow one successful refresh.
update public.catalog_refresh_state
set next_attempt_at = clock_timestamp() - interval '1 second',
    last_attempt_at = clock_timestamp() - interval '25 hours';
set local role service_role;
do $$
declare
  v_token uuid := public.claim_catalog_refresh();
  v_state public.catalog_refresh_state%rowtype;
begin
  if v_token is null or not public.finish_catalog_refresh(v_token, true, '{"refreshed":1}') then
    raise exception 'Eligible successful refresh failed';
  end if;
  select * into strict v_state from public.catalog_refresh_state;
  if v_state.last_success_at is null or v_state.status <> 'succeeded'
    or v_state.next_attempt_at - v_state.last_success_at < interval '24 hours'
    or v_state.lease_token is not null then
    raise exception 'Success did not preserve 24 hours of catalogue freshness';
  end if;
  if public.claim_catalog_refresh() is not null then raise exception 'Fresh catalogue refreshed again'; end if;
end;
$$;
reset role;

-- Last success independently protects fresh content, even with an old cooldown.
update public.catalog_refresh_state set next_attempt_at = '-infinity';
do $$
begin
  if public.claim_catalog_refresh() is not null then raise exception 'Last success freshness ignored'; end if;
end;
$$;

-- A crashed worker loses its lease, but retains its already-consumed daily budget.
update public.catalog_refresh_state
set last_success_at = null, next_attempt_at = '-infinity';
select public.claim_catalog_refresh();
update public.catalog_refresh_state set next_attempt_at = '-infinity';
do $$
begin
  if public.claim_catalog_refresh() is not null then raise exception 'Active lease was replaced'; end if;
end;
$$;
update public.catalog_refresh_state
set next_attempt_at = last_attempt_at + interval '24 hours';
update public.catalog_refresh_state set lease_until = clock_timestamp() - interval '1 second';
do $$
declare
  v_token uuid;
begin
  select lease_token into v_token from public.catalog_refresh_state;
  if public.finish_catalog_refresh(v_token, true, '{}') then raise exception 'Expired lease finished'; end if;
  if public.claim_catalog_refresh() is not null then raise exception 'Expired worker bypassed the daily budget'; end if;
end;
$$;

-- Tomorrow a new lease replaces the abandoned token; the old worker stays fenced.
update public.catalog_refresh_state set next_attempt_at = '-infinity';
do $$
declare
  v_old_token uuid;
  v_new_token uuid;
begin
  select lease_token into v_old_token from public.catalog_refresh_state;
  v_new_token := public.claim_catalog_refresh();
  if v_new_token is null or v_new_token = v_old_token then raise exception 'Abandoned lease was not replaced'; end if;
  if public.finish_catalog_refresh(v_old_token, true, '{}') then raise exception 'Replaced worker finished'; end if;
end;
$$;

-- A missing singleton row cannot authorize unmetered work.
delete from public.catalog_refresh_state;
do $$
begin
  if public.claim_catalog_refresh() is not null then raise exception 'Missing state did not fail closed'; end if;
end;
$$;

rollback;
\echo 'Catalogue refresh database tests passed.'
