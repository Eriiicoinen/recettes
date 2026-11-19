-- Liens secrets du connecteur Claude (serveur MCP). Seule l'empreinte SHA-256 du code est stockée.
create extension if not exists pgcrypto with schema extensions;

create table public.connector_tokens (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'Claude',
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index on public.connector_tokens (household_id);

alter table public.connector_tokens enable row level security;
create policy "members see tokens" on public.connector_tokens for select using (public.is_member(household_id));
create policy "members revoke tokens" on public.connector_tokens for delete using (public.is_member(household_id));
grant select, delete on public.connector_tokens to authenticated;

-- Crée un code et le renvoie une seule fois en clair
create or replace function public.create_connector_token(p_label text default 'Claude') returns text
language plpgsql security definer set search_path = '' as $$
declare
  h uuid;
  t text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select household_id into h from public.household_members where user_id = auth.uid() order by joined_at limit 1;
  if h is null then raise exception 'Aucun foyer'; end if;
  t := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.connector_tokens (household_id, user_id, label, token_hash)
  values (h, auth.uid(), coalesce(nullif(trim(p_label), ''), 'Claude'), encode(extensions.digest(t, 'sha256'), 'hex'));
  return t;
end $$;

revoke execute on function public.create_connector_token(text) from anon, public;
grant execute on function public.create_connector_token(text) to authenticated;
