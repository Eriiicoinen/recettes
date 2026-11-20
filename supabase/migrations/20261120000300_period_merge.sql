-- Découpe par défaut entre deux périodes personnalisées : semaines de 7 jours, sauf qu'un morceau de moins de
-- 4 jours collé à une période personnalisée est fusionné avec la semaine voisine (périodes de 4 à 10 jours).
-- Même algorithme que app/src/lib/period.ts et supabase/functions/_shared/period.ts.
create or replace function public.period_of(p_household uuid, p_day date, out p_start date, out p_days int)
language plpgsql stable set search_path = '' as $$
declare
  v_dow int;
  v_lo date;   -- fin (exclue) de la période personnalisée précédente
  v_hi date;   -- début de la période personnalisée suivante
  v_b0 date;
  v_edges date[];
  v_bounds date[];
  i int;
begin
  select p.start, p.days into p_start, p_days from public.periods p
   where p.household_id = p_household and p.start <= p_day and p_day < p.start + p.days;
  if found then return; end if;

  select week_start_dow into v_dow from public.households where id = p_household;
  select max(p.start + p.days) into v_lo from public.periods p where p.household_id = p_household and p.start + p.days <= p_day;
  select min(p.start) into v_hi from public.periods p where p.household_id = p_household and p.start > p_day;

  v_b0 := public.period_start(p_day, coalesce(v_dow, 1));
  -- Débuts de semaine autour de la date, entre les deux périodes personnalisées
  select array_agg(b order by b) into v_bounds
    from generate_series(v_b0 - 21, v_b0 + 21, interval '7 days') g(t), lateral (select t::date as b) x
   where (v_lo is null or x.b > v_lo) and (v_hi is null or x.b < v_hi);
  v_bounds := coalesce(v_bounds, '{}');
  -- Morceaux trop courts collés aux périodes personnalisées : on ignore la limite de semaine
  if v_lo is not null and array_length(v_bounds, 1) > 0 and v_bounds[1] - v_lo < 4 then v_bounds := v_bounds[2:]; end if;
  if v_hi is not null and array_length(v_bounds, 1) > 0 and v_hi - v_bounds[array_length(v_bounds, 1)] < 4 then
    v_bounds := v_bounds[1:array_length(v_bounds, 1) - 1];
  end if;

  v_edges := v_bounds;
  if v_lo is not null then v_edges := array_prepend(v_lo, v_edges); end if;
  if v_hi is not null then v_edges := array_append(v_edges, v_hi); end if;

  -- Morceau contenant la date
  p_start := null;
  for i in 1 .. coalesce(array_length(v_edges, 1), 0) loop
    if v_edges[i] <= p_day then p_start := v_edges[i]; end if;
  end loop;
  if p_start is null then p_start := v_b0; end if; -- sécurité (ne devrait pas arriver)
  p_days := 7;
  for i in 1 .. coalesce(array_length(v_edges, 1), 0) loop
    if v_edges[i] > p_start then p_days := v_edges[i] - p_start; exit; end if;
  end loop;
end $$;
