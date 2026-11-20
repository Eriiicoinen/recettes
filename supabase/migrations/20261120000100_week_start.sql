-- Jour de début de semaine réglable par foyer (0 = dimanche … 6 = samedi, comme getDay() en JS ; 1 = lundi par défaut).
-- week_start (menu et courses) = premier jour de la période qui contient la date.
alter table public.households add column week_start_dow smallint not null default 1 check (week_start_dow between 0 and 6);

create or replace function public.period_start(p_day date, p_dow int) returns date
language sql immutable set search_path = '' as $$
  select p_day - ((extract(dow from p_day)::int - p_dow + 7) % 7)
$$;
grant execute on function public.period_start(date, int) to authenticated, service_role;

-- Change le début de semaine et regroupe les données existantes dans la nouvelle découpe.
-- Les repas gardent leur jour ; les lignes de courses issues du menu sont recalculées à l'ouverture de la liste.
create or replace function public.set_week_start(p_household uuid, p_dow int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member(p_household) then raise exception 'forbidden'; end if;
  if p_dow is null or p_dow < 0 or p_dow > 6 then raise exception 'Jour invalide'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_household::text || 'week_start', 0));

  update public.households set week_start_dow = p_dow where id = p_household;

  -- Menu : repas placés → période de leur jour ; repas sans jour → période qui contient leur ancien début de semaine
  update public.week_items
     set week_start = public.period_start(coalesce(day, week_start), p_dow)
   where household_id = p_household;

  -- Courses : les lignes du menu seront régénérées pour la nouvelle découpe
  delete from public.shopping_items where household_id = p_household and origin = 'menu';
  -- Articles réguliers : un seul par période après regroupement
  delete from public.shopping_items s
   using public.shopping_items t
   where s.household_id = p_household and t.household_id = p_household
     and s.recurring_id is not null and s.recurring_id = t.recurring_id
     and public.period_start(s.week_start, p_dow) = public.period_start(t.week_start, p_dow)
     and (s.checked, s.id::text) < (t.checked, t.id::text);
  update public.shopping_items
     set week_start = public.period_start(week_start, p_dow)
   where household_id = p_household;
end $$;
revoke execute on function public.set_week_start(uuid, int) from anon, public;
grant execute on function public.set_week_start(uuid, int) to authenticated;

-- Synchro des courses : « semaine en cours » selon le début de semaine du foyer (articles réguliers)
create or replace function public.sync_shopping_list(p_household uuid, p_week date, p_carry_manual boolean default false)
returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_missing jsonb;
  v_dow int;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_member(p_household) then
    raise exception 'forbidden';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_household::text || p_week::text, 0));
  select week_start_dow into v_dow from public.households where id = p_household;

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

  if p_week >= public.period_start((now() at time zone 'Europe/Paris')::date, coalesce(v_dow, 1)) then
    insert into public.shopping_items (household_id, week_start, origin, label, aisle_id, recurring_id)
    select p_household, p_week, 'recurring', r.label, r.aisle_id, r.id
      from public.recurring_items r
     where r.household_id = p_household
       and not exists (select 1 from public.shopping_items s where s.week_start = p_week and s.recurring_id = r.id)
    on conflict do nothing;
  end if;

  select jsonb_agg(distinct r.name) into v_missing
    from public.week_items w join public.recipes r on r.id = w.recipe_id
   where w.household_id = p_household and w.week_start = p_week
     and not exists (select 1 from public.recipe_ingredients ri where ri.recipe_id = r.id);

  return jsonb_build_object('missing', coalesce(v_missing, '[]'::jsonb));
end $$;
