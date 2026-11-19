-- Un membre ne peut modifier que son prénom dans le foyer : sans cette restriction, la règle « edit own membership »
-- permettait de changer household_id sur sa propre ligne et d'entrer dans n'importe quel foyer dont on connaît l'id.
revoke update on public.household_members from authenticated;
grant update (display_name) on public.household_members to authenticated;

-- Recherche : « % » et « _ » tapés par l'utilisateur sont des caractères ordinaires, pas des jokers LIKE.
create or replace function public.search_recipes(p_household uuid, p_query text)
returns setof public.recipes
language sql stable set search_path = '' as $$
  with q as (select public.f_norm(p_query) as t)
  select r.* from public.recipes r, q
  where r.household_id = p_household
    and (
      q.t = ''
      or strpos(public.f_norm(r.name), q.t) > 0
      or extensions.word_similarity(q.t, public.f_norm(r.name)) > 0.4
      or strpos(public.f_norm(array_to_string(r.tags, ' ')), q.t) > 0
      or strpos(public.f_norm(r.notes), q.t) > 0
      or exists (
        select 1 from public.recipe_ingredients ri join public.ingredients i on i.id = ri.ingredient_id
        where ri.recipe_id = r.id
          and (strpos(public.f_norm(i.name), q.t) > 0
               or extensions.word_similarity(q.t, public.f_norm(i.name)) > 0.5))
    )
  order by
    (strpos(public.f_norm(r.name), q.t) > 0) desc,
    extensions.word_similarity(q.t, public.f_norm(r.name)) desc,
    r.name
$$;

-- Remplace les ingrédients d'une recette en une seule transaction : une coupure réseau ne peut plus
-- laisser la recette sans ingrédients (avant : suppression puis insertion en deux appels).
-- security invoker : les règles RLS de l'utilisateur s'appliquent.
create or replace function public.replace_recipe_ingredients(p_recipe uuid, p_lines jsonb)
returns void
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.recipes r where r.id = p_recipe and public.is_member(r.household_id)) then
    raise exception 'Recette introuvable';
  end if;
  delete from public.recipe_ingredients where recipe_id = p_recipe;
  insert into public.recipe_ingredients (recipe_id, ingredient_id, quantity, unit, note, position)
  select p_recipe, (l->>'ingredient_id')::uuid, (l->>'quantity')::numeric, nullif(l->>'unit', ''),
         nullif(l->>'note', ''), (l->>'position')::int
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as l;
end $$;

revoke execute on function public.replace_recipe_ingredients(uuid, jsonb) from anon, public;
grant execute on function public.replace_recipe_ingredients(uuid, jsonb) to authenticated, service_role;
