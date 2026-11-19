-- Photos des plats. Stockage public en lecture (adresse impossible à deviner : foyer/recette/uuid.jpg),
-- écriture et suppression réservées aux membres du foyer (1er dossier du chemin = id du foyer).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-photos', 'recipe-photos', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create or replace function public.photo_household_ok(p_name text) returns boolean
language plpgsql stable set search_path = '' as $$
begin
  return public.is_member(((storage.foldername(p_name))[1])::uuid);
exception when invalid_text_representation then
  return false;
end $$;
grant execute on function public.photo_household_ok(text) to authenticated;

create policy "members read photos" on storage.objects for select to authenticated
  using (bucket_id = 'recipe-photos' and public.photo_household_ok(name));
create policy "members add photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'recipe-photos' and public.photo_household_ok(name));
create policy "members delete photos" on storage.objects for delete to authenticated
  using (bucket_id = 'recipe-photos' and public.photo_household_ok(name));
