# Recettes & Menus

Carnet de recettes, menus de la semaine et liste de courses partagée entre deux téléphones.
Spécification : [SPEC.md](SPEC.md).

- `app/` : application web installable (PWA), React + Vite.
- `supabase/migrations/` : schéma de la base (Postgres + RLS + temps réel).
- `legacy/menus.gs` : ancienne version Google Sheets.

## Développement local

```sh
cd app
cp .env.example .env.local   # puis remplir l'URL et la clé Supabase
npm install
npm run dev
```

## Base de données

```sh
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push
```

Dans Supabase > Authentication > Email Templates > **Magic Link**, le modèle doit contenir `{{ .Token }}`
(l'app se connecte avec un code à 6 chiffres, pas avec un lien).

## Déploiement

Chaque push sur `main` déploie sur GitHub Pages (`.github/workflows/deploy.yml`).
Variables du dépôt à définir : `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
