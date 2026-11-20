-- Périodes souples : début + nombre de jours.
-- Les périodes enregistrées ici sont personnalisées ; ailleurs, la découpe par défaut est la semaine de 7 jours
-- (début réglé par households.week_start_dow), raccourcie pour ne jamais chevaucher une période personnalisée.
-- week_items.week_start et shopping_items.week_start contiennent le premier jour de la période.
create table public.periods (
  household_id uuid not null references public.households(id) on delete cascade,
  start date not null,
  days smallint not null check (days between 1 and 28),
  primary key (household_id, start)
);
alter table public.periods enable row level security;
create policy "members read" on public.periods for select using (public.is_member(household_id));
grant select on public.periods to authenticated;
grant select, insert, update, delete on public.periods to service_role;
alter publication supabase_realtime add table public.periods;

-- Période (début, nombre de jours) contenant une date
create or replace function public.period_of(p_household uuid, p_day date, out p_start date, out p_days int)
language plpgsql stable set search_path = '' as $$
declare
  v_dow int;
  v_end date;
  v_prev date;
  v_next date;
begin
  select p.start, p.days into p_start, p_days from public.periods p
   where p.household_id = p_household and p.start <= p_day and p_day < p.start + p.days;
  if found then return; end if;
  select week_start_dow into v_dow from public.households where id = p_household;
  p_start := public.period_start(p_day, coalesce(v_dow, 1));
  v_end := p_start + 6;
  -- Raccourcie par les périodes personnalisées voisines
  select max(p.start + p.days) into v_prev from public.periods p where p.household_id = p_household and p.start + p.days <= p_day;
  if v_prev is not null and v_prev > p_start then p_start := v_prev; end if;
  select min(p.start) into v_next from public.periods p where p.household_id = p_household and p.start > p_day;
  if v_next is not null and v_next <= v_end then v_end := v_next - 1; end if;
  p_days := v_end - p_start + 1;
end $$;
grant execute on function public.period_of(uuid, date) to authenticated, service_role;

-- Range menus et courses dans la découpe actuelle (après un changement de période ou de début de semaine)
create or replace function public.rekey_periods(p_household uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Repas placés : période de leur jour ; repas sans jour : période qui contient leur ancien début
  update public.week_items w
     set week_start = (public.period_of(p_household, coalesce(w.day, w.week_start))).p_start
   where w.household_id = p_household;
  -- Lignes du menu : recalculées à l'ouverture de la liste
  delete from public.shopping_items where household_id = p_household and origin = 'menu';
  -- Articles réguliers : un seul par période
  delete from public.shopping_items s
   using public.shopping_items t
   where s.household_id = p_household and t.household_id = p_household
     and s.recurring_id is not null and s.recurring_id = t.recurring_id
     and (public.period_of(p_household, s.week_start)).p_start = (public.period_of(p_household, t.week_start)).p_start
     and (s.checked, s.id::text) < (t.checked, t.id::text);
  update public.shopping_items s
     set week_start = (public.period_of(p_household, s.week_start)).p_start
   where s.household_id = p_household;
end $$;
revoke execute on function public.rekey_periods(uuid) from anon, public, authenticated;

-- Période personnalisée : remplace celles qu'elle chevauche
create or replace function public.set_period(p_household uuid, p_start date, p_days int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member(p_household) then raise exception 'forbidden'; end if;
  if p_start is null or p_days is null or p_days < 1 or p_days > 28 then raise exception 'Période invalide (1 à 28 jours)'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_household::text || 'periods', 0));
  delete from public.periods where household_id = p_household and start < p_start + p_days and p_start < start + days;
  insert into public.periods (household_id, start, days) values (p_household, p_start, p_days);
  perform public.rekey_periods(p_household);
end $$;

-- Revient à la découpe par semaine pour la période contenant cette date
create or replace function public.clear_period(p_household uuid, p_day date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member(p_household) then raise exception 'forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_household::text || 'periods', 0));
  delete from public.periods where household_id = p_household and start <= p_day and p_day < start + days;
  perform public.rekey_periods(p_household);
end $$;
revoke execute on function public.set_period(uuid, date, int) from anon, public;
revoke execute on function public.clear_period(uuid, date) from anon, public;
grant execute on function public.set_period(uuid, date, int) to authenticated;
grant execute on function public.clear_period(uuid, date) to authenticated;

-- Début de semaine : même regroupement
create or replace function public.set_week_start(p_household uuid, p_dow int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member(p_household) then raise exception 'forbidden'; end if;
  if p_dow is null or p_dow < 0 or p_dow > 6 then raise exception 'Jour invalide'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_household::text || 'periods', 0));
  update public.households set week_start_dow = p_dow where id = p_household;
  perform public.rekey_periods(p_household);
end $$;

-- Synchro des courses : articles réguliers à partir de la période en cours
create or replace function public.sync_shopping_list(p_household uuid, p_week date, p_carry_manual boolean default false)
returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_missing jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_member(p_household) then
    raise exception 'forbidden';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_household::text || p_week::text, 0));

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

  if p_week >= (public.period_of(p_household, (now() at time zone 'Europe/Paris')::date)).p_start then
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
