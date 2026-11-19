-- Unité du conditionnement (g, ml, ou '' pour des pièces) : appliqué seulement aux lignes de la même unité
alter table public.ingredients add column pack_unit text;
