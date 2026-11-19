# Recettes & Menus

Carnet de recettes, menus de la semaine et liste de courses partagÃ©e entre deux tÃ©lÃ©phones.
SpÃ©cification : [SPEC.md](SPEC.md).

- `app/` : application web installable (PWA), React + Vite.
- `supabase/migrations/` : schÃ©ma de la base (Postgres + RLS + temps rÃ©el).
- `legacy/menus.gs` : ancienne version Google Sheets.

## DÃ©veloppement local

```sh
cd app
cp .env.example .env.local   # puis remplir l'URL et la clÃ© Supabase
npm install
npm run dev
```

## Base de donnÃ©es

```sh
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push
```

Dans Supabase > Authentication > Email Templates > **Magic Link**, le modÃ¨le doit contenir `{{ .Token }}`
(l'app se connecte avec un code Ã  6 chiffres, pas avec un lien).

## DÃ©ploiement

Chaque push sur `main` dÃ©ploie sur GitHub Pages (`.github/workflows/deploy.yml`).
Variables du dÃ©pÃ´t Ã  dÃ©finir : `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
