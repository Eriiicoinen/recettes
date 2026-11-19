-- Liste de courses générée à partir du menu d'une semaine (panier + créneaux).
-- Quantités cumulées et mises à l'échelle des parts prévues ; g/kg et ml/cl/dl/l fusionnés (stockés en g et ml).

-- Lignes voulues pour une semaine : une par (ingrédient, famille d'unité)
create or replace function public.shopping_desired(p_household uuid, p_week date)
returns table (ingredient_id uuid, ukey text, q numeric, sources text[], name text, aisle_id uuid, is_staple boolean)
language sql stable set search_path = '' as $$
  with lines as (
    select ri.ingredient_id,
      case when ri.unit in ('g', 'kg') then 'g'
           when ri.unit in ('ml', 'cl', 'dl', 'l') then 'ml'
           else coalesce(ri.unit, '') end as ukey,
      ri.quantity
        * case ri.unit when 'kg' then 1000 when 'cl' then 10 when 'dl' then 100 when 'l' then 1000 else 1 end
        * (coalesce(w.servings, r.servings)::numeric / r.servings) as q,
      r.name as recipe_name
    from public.week_items w
    join public.recipes r on r.id = w.recipe_id
    join public.recipe_ingredients ri on ri.recipe_id = r.id
    where w.household_id = p_household and w.week_start = p_week
  )
  select l.ingredient_id, l.ukey, round(sum(l.q), 2), array_agg(distinct l.recipe_name order by l.recipe_name),
         i.name, i.aisle_id, i.is_staple
  from lines l join public.ingredients i on i.id = l.ingredient_id
  group by l.ingredient_id, l.ukey, i.name, i.aisle_id, i.is_staple
$$;

-- Met la liste à jour sans toucher aux cases cochées, aux articles masqués ni aux articles ajoutés à la main.
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

  -- Recettes au menu sans ingrédients saisis : signalées plutôt qu'oubliées
  select jsonb_agg(distinct r.name) into v_missing
    from public.week_items w join public.recipes r on r.id = w.recipe_id
   where w.household_id = p_household and w.week_start = p_week
     and not exists (select 1 from public.recipe_ingredients ri where ri.recipe_id = r.id);

  return jsonb_build_object('missing', coalesce(v_missing, '[]'::jsonb));
end $$;

revoke execute on function public.shopping_desired(uuid, date) from anon, public;
revoke execute on function public.sync_shopping_list(uuid, date, boolean) from anon, public;
grant execute on function public.shopping_desired(uuid, date) to authenticated, service_role;
grant execute on function public.sync_shopping_list(uuid, date, boolean) to authenticated, service_role;
