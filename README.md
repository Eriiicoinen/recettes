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
npx supabase db push --remote
```

Connexion par e-mail + mot de passe : dans Supabase > Authentication > Sign In / Providers > Email,
désactiver **Confirm email**. Aucun e-mail n'est envoyé, le plan gratuit suffit.

## Déploiement

Chaque push sur `main` déploie sur GitHub Pages (`.github/workflows/deploy.yml`).
Variables du dépôt à définir : `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
