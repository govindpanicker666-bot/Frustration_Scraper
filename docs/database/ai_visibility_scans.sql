-- AI Visibility Tracker
-- Run this through the Lovable/Supabase database migration workflow.
-- Do not place this file in drizzle/migrations: AGENTS.md reserves database changes for Lovable.

create table if not exists public.ai_visibility_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  brand_name text not null,
  model_name text not null,
  prompt_text text not null,
  visibility_score integer not null default 0
    check (visibility_score between 0 and 100),
  rank_position integer null check (rank_position is null or rank_position > 0),
  sentiment text not null default 'neutral'
    check (sentiment in ('positive', 'neutral', 'negative')),
  citations jsonb not null default '[]'::jsonb
    check (jsonb_typeof(citations) = 'array'),
  created_at timestamptz not null default now()
);

create index if not exists ai_visibility_scans_user_created_idx
  on public.ai_visibility_scans (user_id, created_at desc);

create index if not exists ai_visibility_scans_user_brand_created_idx
  on public.ai_visibility_scans (user_id, brand_name, created_at desc);

alter table public.ai_visibility_scans enable row level security;

grant select, insert on public.ai_visibility_scans to authenticated;
grant all on public.ai_visibility_scans to service_role;

drop policy if exists "Users can read their own AI visibility scans"
  on public.ai_visibility_scans;
create policy "Users can read their own AI visibility scans"
  on public.ai_visibility_scans
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can insert their own AI visibility scans"
  on public.ai_visibility_scans;
create policy "Users can insert their own AI visibility scans"
  on public.ai_visibility_scans
  for insert to authenticated
  with check (user_id = auth.uid());
