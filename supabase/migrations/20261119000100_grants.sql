-- Les projets Supabase récents n'accordent plus automatiquement l'accès aux nouvelles tables.
-- Les utilisateurs connectés reçoivent l'accès aux tables ; ce qu'ils voient reste filtré par les règles RLS.
-- Le rôle anon (non connecté) ne reçoit rien.

grant usage on schema public to authenticated;

grant select, insert, update, delete on
  public.aisles, public.ingredients, public.recipes, public.recipe_ingredients,
  public.week_items, public.shopping_items
to authenticated;

grant select, update on public.households to authenticated;
grant select, update, delete on public.household_members to authenticated;

grant execute on function
  public.f_norm(text), public.is_member(uuid),
  public.create_household(text, text), public.join_household(text, text),
  public.search_recipes(uuid, text)
to authenticated;
