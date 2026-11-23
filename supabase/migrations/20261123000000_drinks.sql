-- « Qu'est-ce qu'on boit ? » : accords proposés pour chaque recette
-- [{ name: « Saint-Joseph rouge », style: rouge|blanc|rosé|bulles|doux|autre, why: « … » }]
alter table public.recipes add column drinks jsonb not null default '[]'::jsonb
  check (jsonb_typeof(drinks) = 'array');
