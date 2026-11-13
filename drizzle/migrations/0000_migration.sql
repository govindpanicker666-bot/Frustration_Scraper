create type public.app_role as enum ('admin','user');
create type public.lead_status as enum ('New','Contacted','Archived');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  company_name text,
  company_url text,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "own profile read" on public.profiles for select to authenticated using (id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "own profile insert" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid());
create policy "own roles read" on public.user_roles for select to authenticated using (user_id = auth.uid());

create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  url text,
  category text,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.competitors to authenticated;
grant all on public.competitors to service_role;
alter table public.competitors enable row level security;
create policy "competitors own" on public.competitors for all to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'))
  with check (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  competitor_name text not null,
  source_platform text not null,
  source_url text not null,
  reviewer_name text,
  reviewer_profile_url text,
  review_text text not null,
  sentiment_score int not null,
  extracted_complaint text,
  suggested_pitch text,
  status lead_status not null default 'New',
  date_scraped timestamptz not null default now(),
  unique (competitor_id, source_url)
);
grant select, insert, update, delete on public.leads to authenticated;
grant all on public.leads to service_role;
alter table public.leads enable row level security;
create policy "leads own" on public.leads for all to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'))
  with check (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict do nothing;
  if not exists (select 1 from public.user_roles where role = 'admin') then
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
  end if;
  insert into public.user_roles (user_id, role) values (new.id, 'user') on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();