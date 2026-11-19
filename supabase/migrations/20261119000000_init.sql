-- Recettes & Menus — schéma initial (M0)
-- Tout est rattaché à un "foyer" (household). Chaque utilisateur ne voit que les données de ses foyers (RLS).

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- unaccent n'est pas IMMUTABLE : wrapper pour pouvoir l'indexer
create or replace function public.f_norm(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, '')))
$$;

-- ------------------------------------------------------------------
-- Foyer & membres
-- ------------------------------------------------------------------
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index on public.household_members (user_id);

create or replace function public.is_member(h uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.household_members m where m.household_id = h and m.user_id = auth.uid())
$$;

-- ------------------------------------------------------------------
-- Rayons, ingrédients, recettes
-- ------------------------------------------------------------------
create table public.aisles (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  position int not null default 0
);
create index on public.aisles (household_id, position);

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  default_unit text,
  aisle_id uuid references public.aisles(id) on delete set null,
  is_staple boolean not null default false,  -- placard : sel, huile…
  created_at timestamptz not null default now()
);
create unique index ingredients_name_uq on public.ingredients (household_id, public.f_norm(name));
create index ingredients_name_trgm on public.ingredients using gin (public.f_norm(name) extensions.gin_trgm_ops);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  category text not null default 'Plat'
    check (category in ('Entrée','Plat','Accompagnement','Soupe','Salade','Dessert','Autre')),
  seasons text[] not null default '{}',     -- vide = toute l'année ; sinon Printemps/Été/Automne/Hiver
  rating smallint check (rating between 1 and 5),
  servings smallint not null default 4 check (servings > 0),
  prep_minutes int,
  cook_minutes int,
  steps text[] not null default '{}',
  notes text,
  tags text[] not null default '{}',
  is_favorite boolean not null default false,
  source_kind text not null default 'manual' check (source_kind in ('manual','url','claude','text','photo')),
  source_url text,
  photo_url text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.recipes (household_id);
create index recipes_name_trgm on public.recipes using gin (public.f_norm(name) extensions.gin_trgm_ops);

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  quantity numeric,          -- null = "à volonté", "1 pincée"…
  unit text,
  note text,                 -- "émincé", "facultatif"…
  position int not null default 0
);
create index on public.recipe_ingredients (recipe_id);
create index on public.recipe_ingredients (ingredient_id);

-- ------------------------------------------------------------------
-- Semaine : panier (day null) + créneaux (day + meal)
-- ------------------------------------------------------------------
create table public.week_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  week_start date not null,                         -- lundi
  recipe_id uuid references public.recipes(id) on delete cascade,
  free_text text,                                   -- "Restes", "Resto"…
  day date,
  meal text check (meal in ('midi','soir')),
  servings smallint check (servings > 0),
  position int not null default 0,
  created_at timestamptz not null default now(),
  check (recipe_id is not null or free_text is not null),
  check ((day is null) = (meal is null))
);
create index on public.week_items (household_id, week_start);

-- ------------------------------------------------------------------
-- Liste de courses
-- ------------------------------------------------------------------
create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  week_start date not null,
  origin text not null check (origin in ('menu','manual')),
  ingredient_id uuid references public.ingredients(id) on delete cascade,
  label text not null,
  quantity numeric,
  unit text,
  aisle_id uuid references public.aisles(id) on delete set null,
  sources text[] not null default '{}',             -- noms des recettes d'origine
  is_staple boolean not null default false,
  hidden boolean not null default false,            -- "j'en ai déjà"
  checked boolean not null default false,
  checked_by uuid references auth.users(id) on delete set null,
  checked_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.shopping_items (household_id, week_start);

-- ------------------------------------------------------------------
-- updated_at
-- ------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
create trigger recipes_touch before update on public.recipes
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------------
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.aisles enable row level security;
alter table public.ingredients enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.week_items enable row level security;
alter table public.shopping_items enable row level security;

create policy "members read household" on public.households for select using (public.is_member(id));
create policy "members rename household" on public.households for update using (public.is_member(id));

create policy "members see members" on public.household_members for select using (public.is_member(household_id));
create policy "edit own membership" on public.household_members for update using (user_id = auth.uid());
create policy "leave household" on public.household_members for delete using (user_id = auth.uid());

create policy "members all" on public.aisles for all
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy "members all" on public.ingredients for all
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy "members all" on public.recipes for all
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy "members all" on public.recipe_ingredients for all
  using (exists (select 1 from public.recipes r where r.id = recipe_id and public.is_member(r.household_id)))
  with check (exists (select 1 from public.recipes r where r.id = recipe_id and public.is_member(r.household_id)));
create policy "members all" on public.week_items for all
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy "members all" on public.shopping_items for all
  using (public.is_member(household_id)) with check (public.is_member(household_id));

-- ------------------------------------------------------------------
-- RPC : créer / rejoindre un foyer
-- ------------------------------------------------------------------
create or replace function public.create_household(p_name text, p_display_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.households (name) values (p_name) returning id into h;
  insert into public.household_members (household_id, user_id, display_name) values (h, auth.uid(), p_display_name);
  insert into public.aisles (household_id, name, position)
  select h, a.name, a.pos from unnest(array[
    'Fruits & légumes','Boucherie / poisson','Crèmerie','Épicerie','Boulangerie',
    'Surgelés','Boissons','Hygiène / maison','Autre']) with ordinality as a(name, pos);
  return h;
end $$;

create or replace function public.join_household(p_code text, p_display_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select id into h from public.households where invite_code = upper(trim(p_code));
  if h is null then raise exception 'Code d''invitation inconnu'; end if;
  insert into public.household_members (household_id, user_id, display_name)
  values (h, auth.uid(), p_display_name) on conflict do nothing;
  return h;
end $$;

revoke execute on function public.create_household(text, text) from anon;
revoke execute on function public.join_household(text, text) from anon;

-- ------------------------------------------------------------------
-- Recherche : nom, ingrédients, tags, notes — sans accents, tolérante aux fautes
-- ------------------------------------------------------------------
create or replace function public.search_recipes(p_household uuid, p_query text)
returns setof public.recipes
language sql stable set search_path = '' as $$
  with q as (select public.f_norm(p_query) as t)
  select r.* from public.recipes r, q
  where r.household_id = p_household
    and (
      q.t = ''
      or public.f_norm(r.name) like '%' || q.t || '%'
      or extensions.word_similarity(q.t, public.f_norm(r.name)) > 0.4
      or public.f_norm(array_to_string(r.tags, ' ')) like '%' || q.t || '%'
      or public.f_norm(r.notes) like '%' || q.t || '%'
      or exists (
        select 1 from public.recipe_ingredients ri join public.ingredients i on i.id = ri.ingredient_id
        where ri.recipe_id = r.id
          and (public.f_norm(i.name) like '%' || q.t || '%'
               or extensions.word_similarity(q.t, public.f_norm(i.name)) > 0.5))
    )
  order by
    (public.f_norm(r.name) like '%' || q.t || '%') desc,
    extensions.word_similarity(q.t, public.f_norm(r.name)) desc,
    r.name
$$;

-- ------------------------------------------------------------------
-- Temps réel
-- ------------------------------------------------------------------
alter publication supabase_realtime add table
  public.recipes, public.recipe_ingredients, public.ingredients, public.aisles,
  public.week_items, public.shopping_items, public.household_members;
