-- Repas sans recette (raclette, fondue, apéro dînatoire, pizzas…) : juste une liste de courses, pas d'étapes.
alter table public.recipes add column is_simple boolean not null default false;
