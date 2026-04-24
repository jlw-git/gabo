-- Gabo schema — mirrors PRD §3.
-- Run in Supabase SQL editor, or via `supabase db push` with the CLI.

create extension if not exists "pgcrypto";

-- profiles ---------------------------------------------------------------
create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  planner_name text not null,
  partner_name text not null,
  cuisines_loved text[] not null default '{}',
  cuisines_avoided text[] not null default '{}',
  dietary_hardstops text[] not null default '{}',
  vibe_default text not null check (vibe_default in ('cozy','adventurous','celebratory','low_key')),
  budget_band int not null check (budget_band between 1 and 4),
  transit_pref text not null check (transit_pref in ('mrt','grab','either')) default 'either',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;
create policy profiles_select_own on profiles for select using (auth.uid() = user_id);
create policy profiles_insert_own on profiles for insert with check (auth.uid() = user_id);
create policy profiles_update_own on profiles for update using (auth.uid() = user_id);
create policy profiles_delete_own on profiles for delete using (auth.uid() = user_id);

-- start_points -----------------------------------------------------------
create table start_points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  lat double precision not null,
  lng double precision not null,
  is_default_a boolean not null default false,
  is_default_b boolean not null default false,
  created_at timestamptz not null default now()
);

alter table start_points enable row level security;
create policy start_points_select_own on start_points for select using (auth.uid() = user_id);
create policy start_points_insert_own on start_points for insert with check (auth.uid() = user_id);
create policy start_points_update_own on start_points for update using (auth.uid() = user_id);
create policy start_points_delete_own on start_points for delete using (auth.uid() = user_id);

-- venues — public catalog, no RLS (readable by anon and authenticated) ---
create table venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lat double precision not null,
  lng double precision not null,
  address text,
  cuisine_tags text[] not null default '{}',
  vibe_tags text[] not null default '{}',
  dietary_flags text[] not null default '{}',
  budget_band int not null check (budget_band between 1 and 4),
  is_outdoor boolean not null default false,
  photo_url text,
  chope_url text,
  hours_json jsonb,
  ph_hours_json jsonb,
  badge text not null check (badge in ('closing_soon','soft_launch','critic_pick','award_fresh','none')) default 'none',
  badge_meta jsonb,
  trending_score numeric not null default 0 check (trending_score between 0 and 1),
  active boolean not null default true
);

grant select on venues to anon, authenticated;

-- Supabase/PostgREST blocks reads by default even with a grant unless RLS is
-- on WITH a policy. We want the catalog to be public, so enable RLS with a
-- permissive read-only policy.
alter table venues enable row level security;
create policy venues_public_read on venues for select to anon, authenticated using (true);

create index venues_active_budget_idx on venues (active, budget_band);
create index venues_cuisine_tags_gin on venues using gin (cuisine_tags);
create index venues_dietary_flags_gin on venues using gin (dietary_flags);

-- plans ------------------------------------------------------------------
create table plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  venue_id uuid not null references venues(id),
  start_a_lat double precision not null,
  start_a_lng double precision not null,
  start_b_lat double precision not null,
  start_b_lng double precision not null,
  scheduled_for timestamptz not null,
  override_tags text[] not null default '{}',
  card_bucket text not null check (card_bucket in ('safe','stretch','wild')),
  eta_a_min int,
  eta_b_min int,
  fairness_gap_min int,
  booked boolean not null default false,
  created_at timestamptz not null default now()
);

alter table plans enable row level security;
create policy plans_select_own on plans for select using (auth.uid() = user_id);
create policy plans_insert_own on plans for insert with check (auth.uid() = user_id);
create policy plans_update_own on plans for update using (auth.uid() = user_id);

-- feedback ---------------------------------------------------------------
create table feedback (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating int not null check (rating in (-1, 1)),
  note text,
  created_at timestamptz not null default now()
);

alter table feedback enable row level security;
create policy feedback_select_own on feedback for select using (auth.uid() = user_id);
create policy feedback_insert_own on feedback for insert with check (auth.uid() = user_id);
