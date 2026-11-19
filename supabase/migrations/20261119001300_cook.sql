-- Qui cuisine ce repas (facultatif)
alter table public.week_items add column cook_id uuid references auth.users(id) on delete set null;
