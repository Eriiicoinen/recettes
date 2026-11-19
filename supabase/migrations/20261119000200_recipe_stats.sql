-- « Dernière fois » et « Nb de fois » d'une recette, déduits des créneaux passés de la semaine.
-- security_invoker : la vue applique les règles RLS de l'utilisateur qui la lit.
create view public.recipe_stats with (security_invoker = true) as
  select recipe_id, max(day) as last_cooked, count(*)::int as times_cooked
  from public.week_items
  where recipe_id is not null and day is not null and day <= current_date
  group by recipe_id;

grant select on public.recipe_stats to authenticated;
