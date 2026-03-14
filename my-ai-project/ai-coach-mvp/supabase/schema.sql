create extension if not exists pgcrypto;

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  storage_key text not null unique,
  original_name text not null,
  content_type text,
  byte_size bigint,
  access_token_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null,
  template_file_id uuid references public.files(id) on delete set null,
  filled_file_id uuid references public.files(id) on delete set null,
  slots jsonb not null default '[]'::jsonb,
  last_results jsonb not null default '[]'::jsonb,
  source_texts jsonb not null default '[]'::jsonb,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists files_owner_user_id_idx on public.files(owner_user_id);
create index if not exists workspaces_owner_user_id_idx on public.workspaces(owner_user_id);
create index if not exists workspaces_updated_at_idx on public.workspaces(updated_at desc);

alter table public.files enable row level security;
alter table public.workspaces enable row level security;

create policy "files_select_own"
on public.files
for select
using (auth.uid() = owner_user_id);

create policy "files_insert_own"
on public.files
for insert
with check (auth.uid() = owner_user_id);

create policy "files_update_own"
on public.files
for update
using (auth.uid() = owner_user_id)
with check (auth.uid() = owner_user_id);

create policy "files_delete_own"
on public.files
for delete
using (auth.uid() = owner_user_id);

create policy "workspaces_select_own"
on public.workspaces
for select
using (auth.uid() = owner_user_id);

create policy "workspaces_insert_own"
on public.workspaces
for insert
with check (auth.uid() = owner_user_id);

create policy "workspaces_update_own"
on public.workspaces
for update
using (auth.uid() = owner_user_id)
with check (auth.uid() = owner_user_id);

create policy "workspaces_delete_own"
on public.workspaces
for delete
using (auth.uid() = owner_user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists files_set_updated_at on public.files;
create trigger files_set_updated_at
before update on public.files
for each row
execute function public.set_updated_at();

drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at
before update on public.workspaces
for each row
execute function public.set_updated_at();
