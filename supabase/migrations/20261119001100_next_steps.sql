-- 1) Conditionnement : « vendu par paquet de 150 g », « boîte de 6 ».
alter table public.ingredients
  add column pack_size numeric check (pack_size > 0),
  add column pack_label text;  -- « paquet », « boîte », « bouteille »… (l'unité est celle de la liste : g, ml ou pièces)

-- 2) Notifications (rappel du dimanche) : un abonnement par téléphone.
create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create policy "own subscriptions" on public.push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member(household_id));
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;

-- Planification : l'appel hebdomadaire est créé à part (il contient une clé secrète, gardée dans le coffre Vault)
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
