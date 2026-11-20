-- Mode drive : produit habituel du magasin (lien Intermarché) pour un article de la liste.
-- Clé = nom de l'article normalisé côté app (sans accents, singulier), commune aux articles du menu, ajoutés à la main ou réguliers.
create table public.store_products (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  item_key text not null,
  url text not null check (url ~ '^https://'),
  title text,
  updated_at timestamptz not null default now(),
  unique (household_id, item_key)
);
alter table public.store_products enable row level security;
create policy "members all" on public.store_products for all
  using (public.is_member(household_id)) with check (public.is_member(household_id));
grant select, insert, update, delete on public.store_products to authenticated, service_role;
alter publication supabase_realtime add table public.store_products;
