-- Fonctions P1 : taille du foyer, restes, avis après le repas, articles réguliers.

-- ------------------------------------------------------------------ taille du foyer
-- Nombre de personnes par défaut quand une recette « pour N personnes » est ajoutée à la semaine
alter table public.households add column people smallint not null default 2 check (people between 1 and 20);
revoke update on public.households from authenticated;
grant update (name, people) on public.households to authenticated;

-- ------------------------------------------------------------------ semaine : restes et avis
-- « Restes : … » rattaché au repas cuisiné en double : supprimé avec lui
alter table public.week_items add column leftover_of uuid references public.week_items(id) on delete cascade;
-- Avis donné (ou ignoré) après le repas : la question n'est plus posée
alter table public.week_items add column reviewed_at timestamptz;
create index on public.week_items (leftover_of);

-- ------------------------------------------------------------------ articles réguliers (lait, pain, café…)
create table public.recurring_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  label text not null,
  aisle_id uuid references public.aisles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index recurring_items_label_uq on public.recurring_items (household_id, public.f_norm(label));
alter table public.recurring_items enable row level security;
create policy "members all" on public.recurring_items for all
  using (public.is_member(household_id)) with check (public.is_member(household_id));
grant select, insert, update, delete on public.recurring_items to authenticated;
grant select, insert, update, delete on public.recurring_items to service_role;
alter publication supabase_realtime add table public.recurring_items;

alter table public.shopping_items drop constraint shopping_items_origin_check;
alter table public.shopping_items add constraint shopping_items_origin_check check (origin in ('menu', 'manual', 'recurring'));
alter table public.shopping_items add column recurring_id uuid references public.recurring_items(id) on delete cascade;
create unique index shopping_items_recurring_uq on public.shopping_items (week_start, recurring_id) where recurring_id is not null;

-- ------------------------------------------------------------------ synchro : + articles réguliers
create or replace function public.sync_shopping_list(p_household uuid, p_week date, p_carry_manual boolean default false)
returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_missing jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_member(p_household) then
    raise exception 'forbidden';
  end if;
  -- Deux téléphones qui synchronisent en même temps : l'un attend l'autre
  perform pg_advisory_xact_lock(hashtextextended(p_household::text || p_week::text, 0));

  -- Articles ajoutés à la main et pas encore achetés : ils suivent dans la semaine en cours
  if p_carry_manual then
    update public.shopping_items set week_start = p_week
    where household_id = p_household and origin = 'manual' and not checked and week_start < p_week;
  end if;

  update public.shopping_items s
     set quantity = d.q, sources = d.sources, label = d.name, aisle_id = d.aisle_id, is_staple = d.is_staple
    from public.shopping_desired(p_household, p_week) d
   where s.household_id = p_household and s.week_start = p_week and s.origin = 'menu'
     and s.ingredient_id = d.ingredient_id and coalesce(s.unit, '') = d.ukey
     and (s.quantity is distinct from d.q or s.sources is distinct from d.sources or s.label <> d.name
          or s.aisle_id is distinct from d.aisle_id or s.is_staple <> d.is_staple);

  insert into public.shopping_items (household_id, week_start, origin, ingredient_id, label, quantity, unit, aisle_id, sources, is_staple)
  select p_household, p_week, 'menu', d.ingredient_id, d.name, d.q, nullif(d.ukey, ''), d.aisle_id, d.sources, d.is_staple
    from public.shopping_desired(p_household, p_week) d
   where not exists (
     select 1 from public.shopping_items s
      where s.household_id = p_household and s.week_start = p_week and s.origin = 'menu'
        and s.ingredient_id = d.ingredient_id and coalesce(s.unit, '') = d.ukey);

  delete from public.shopping_items s
   where s.household_id = p_household and s.week_start = p_week and s.origin = 'menu'
     and not exists (
       select 1 from public.shopping_desired(p_household, p_week) d
        where d.ingredient_id = s.ingredient_id and d.ukey = coalesce(s.unit, ''));

  -- Articles réguliers : ajoutés une fois par semaine, à partir de la semaine en cours (pas dans l'historique).
  -- Retirés de la liste par « j'en ai déjà » (masqués), donc pas réajoutés ensuite.
  if p_week >= (date_trunc('week', now() at time zone 'Europe/Paris'))::date then
    insert into public.shopping_items (household_id, week_start, origin, label, aisle_id, recurring_id)
    select p_household, p_week, 'recurring', r.label, r.aisle_id, r.id
      from public.recurring_items r
     where r.household_id = p_household
       and not exists (select 1 from public.shopping_items s where s.week_start = p_week and s.recurring_id = r.id)
    on conflict do nothing;
  end if;

  -- Recettes au menu sans ingrédients saisis : signalées plutôt qu'oubliées
  select jsonb_agg(distinct r.name) into v_missing
    from public.week_items w join public.recipes r on r.id = w.recipe_id
   where w.household_id = p_household and w.week_start = p_week
     and not exists (select 1 from public.recipe_ingredients ri where ri.recipe_id = r.id);

  return jsonb_build_object('missing', coalesce(v_missing, '[]'::jsonb));
end $$;

-- ------------------------------------------------------------------ avis après le repas
-- Note la recette, ajoute le commentaire daté aux notes et marque le repas comme évalué (tout ou rien)
create or replace function public.review_meal(p_item uuid, p_rating int, p_note text)
returns void language plpgsql set search_path = '' as $$
declare
  v_recipe uuid;
  v_day date;
begin
  select w.recipe_id, w.day into v_recipe, v_day from public.week_items w
   where w.id = p_item and public.is_member(w.household_id);
  if not found then raise exception 'Repas introuvable'; end if;
  if p_rating is not null and (p_rating < 1 or p_rating > 5) then raise exception 'Note invalide'; end if;
  if v_recipe is not null and (p_rating is not null or nullif(trim(p_note), '') is not null) then
    update public.recipes r set
      rating = coalesce(p_rating, r.rating),
      notes = case when nullif(trim(p_note), '') is null then r.notes
                   else concat_ws(E'\n', nullif(r.notes, ''), to_char(coalesce(v_day, current_date), 'DD/MM/YYYY') || ' : ' || trim(p_note)) end
     where r.id = v_recipe;
  end if;
  update public.week_items set reviewed_at = now() where id = p_item;
end $$;
revoke execute on function public.review_meal(uuid, int, text) from anon, public;
grant execute on function public.review_meal(uuid, int, text) to authenticated;
