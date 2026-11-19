# Recettes & Menus: product spec (epics & capabilities)

> Status: draft for review, 2026-11-19. No development has started.
> Replaces: `menus.gs` (Google Sheets + Apps Script), which works but is not user-friendly on a phone.

## 1. Goal

A simple app for a household of 2 to:
1. keep a **recipe book**,
2. plan the **week's menus** (lunch and dinner),
3. get a **shopping list** generated automatically and **shared live** between both phones.

**Hard constraints**
- Works on **1 Android + 1 iPhone**, with **real-time sync** between them.
- Phone-first, usable with one hand in a store, with no tutorial needed.
- Shopping list usable **offline** (poor signal in stores), syncing when back online.
- UI language: **French**.
- Low or zero running cost.

## 2. Recommended approach (to validate)

| Option | Pros | Cons |
|---|---|---|
| **PWA (installable web app)** + hosted backend ✅ | One codebase; installs on the home screen for Android and iOS; no app store; free hosting | iOS push notifications only work once the app is added to the home screen |
| Native (React Native / Expo) | Most "native" feel | App Store publishing ($99/yr Apple) or a TestFlight hassle; heavier to maintain |
| Keep Google Sheets | Already exists | Exactly the problem we want to fix |

**Recommendation: PWA.**
- Front end: React + Vite, PWA (service worker, offline cache).
- Backend and sync: **Supabase** (Postgres + Auth + Realtime, free tier), or Firebase Firestore. Both handle offline use and real-time updates.
- Hosting: Vercel / Netlify / Cloudflare Pages (free).
- Authentication: one "household" account shared by both phones, or 2 accounts in the same household (magic link by email).

## 3. Data model (overview)

- **Household**: members (2).
- **Recipe**: name, category (Entrée, Plat, Accompagnement, Soupe, Salade, Dessert, Autre), season(s), rating, default servings, prep/cook time, steps, photo (optional), source/link, tags.
- **Ingredient**: name, default unit, store aisle (remembered for reuse).
- **RecipeIngredient**: recipe → ingredient, quantity, unit.
- **MealSlot**: date, meal (Midi/Soir), recipe(s) or free text, servings.
- **ShoppingItem**: ingredient or free text, total quantity, aisle, checked yes/no, origin (menu / manual), checked by whom.
- **History**: derived from past MealSlots (last time cooked, number of times).

## 4. Epics & capabilities

Priorities: **P0** = MVP (replaces the Sheet) · **P1** = soon after · **P2** = nice to have.

### Epic 1: Account, household & sync (P0)
- 1.1 Sign in on both phones and join the same household (invite link or code).
- 1.2 Real-time sync: a change on one phone shows on the other within seconds.
- 1.3 Offline mode: reading everything and checking off shopping items work without network; changes sync when the connection returns.
- 1.4 Conflict handling: last write wins per field. Two people checking the same item is not a conflict.
- 1.5 Install to the home screen (Android and iOS), with an app icon and splash screen.

### Epic 2: Recipe book (P0)
- 2.1 List recipes with search and filters (category, season, rating, "not cooked for a while").
- 2.2 Create or edit a recipe: name, category, season, rating, servings, ingredients (quantity + unit + ingredient), steps, notes.
- 2.3 Autocomplete ingredients; reuse the unit and aisle already known for that ingredient.
- 2.4 Recipe page in "cooking" mode: large text, keep screen on, check off steps, scale servings.
- 2.5 Show "last cooked" date and "cooked N times".
- 2.6 *(P1)* Recipe photo.
- 2.7 *(moved to Epic 7)*
- 2.8 *(P0, one-time)* **Import the existing data** from the Google Sheet (Recettes, Ingrédients and Historique tabs exported as CSV).
- 2.9 *(P0)* **Search across everything**: recipe name, ingredients ("what can I make with leeks?"), tags, notes. Search is forgiving: it ignores accents and case and tolerates typos ("poireau" also finds "Poireaux").
- 2.10 *(P1)* Saved filters / quick chips: "Rapide (< 30 min)", "De saison", "Pas fait depuis longtemps", "Favoris".

### Epic 3: Weekly menu (P0)
- 3.0 **"Recettes de la semaine" basket**: from the recipe book or search, tap "Ajouter à la semaine" on any recipe. The basket alone is enough to generate the shopping list. Placing recipes on a specific day is optional.
- 3.1 Week view: 7 days × lunch/dinner, scrollable, with the current day highlighted.
- 3.2 Fill a slot by tapping it, then picking a recipe (search) or typing free text ("restes", "resto"…).
- 3.3 Servings per slot (default from the recipe).
- 3.4 Move or swap meals (drag and drop, or a "move to…" action).
- 3.5 Navigate between past and future weeks; past weeks are the history (no manual "archive" step).
- 3.6 **Ideas**: suggest well-rated, in-season recipes not cooked in the last 30 days and not already on the menu; add one in a single tap.
- 3.7 *(P1)* "Repeat a past week" / duplicate a menu.
- 3.8 *(P2)* Auto-fill the empty slots of the week from the ideas.

### Epic 4: Shopping list (P0)
- 4.1 Generated automatically from **the recipes selected for the week** (basket + day slots): quantities summed across recipes and scaled by servings, units merged (e.g. 200 g + 0.5 kg → 700 g). Each line shows which recipe(s) it comes from.
- 4.2 Grouped by **aisle**, in an order that matches the route through the store (configurable).
- 4.3 Check off an item with a tap; checked items drop to the bottom or hide; synced live to the other phone.
- 4.4 Add manual items ("Autres achats"); they stay until checked.
- 4.5 Regenerating the list after the menu changes keeps checked items checked and manual items in place.
- 4.6 Warn when a recipe on the menu has no ingredients entered.
- 4.7 "Pantry staples" list (salt, oil…), hidden by default or shown in a separate section.
- 4.8 *(P1)* Choose the period for the list (e.g. Saturday → Friday, or only the next 3 days).
- 4.9 *(P1)* Edit the quantity of a generated line, or delete it ("already have it").
- 4.10 *(P2)* Several stores, each with its own aisle order.

### Epic 7: Recipe capture: from Claude and from the web (P0)
Goal: saving a recipe takes **one action**, never retyping. Every capture path goes through one common pipeline: **raw content → structured recipe (name, servings, ingredients with quantity/unit/aisle, steps) → preview screen → save**. Unknown ingredients are matched to existing ones, or created with a guessed aisle.

**From a Claude chat**
- 7.1 *(P0)* **"Recettes" connector for Claude** (remote MCP server hosted with the backend). In any Claude conversation (claude.ai, the mobile app or Claude Code), saying "ajoute cette recette à mon carnet" makes Claude call the `add_recipe` tool with the structured recipe. It appears in the app instantly. One-time setup: add the connector URL in Claude's settings → Connectors.
- 7.2 *(P1)* More connector tools: `search_recipes`, `get_recipe`, `add_to_week`, `get_shopping_list`, `add_shopping_item`. This lets Claude say "plan my week with what's in my book" or "add milk to the list".
- 7.3 *(P0, fallback)* **Paste text**: copy a recipe from any chat or message, then use "Coller une recette" in the app → parsed into a structured recipe → preview.

**From the web**
- 7.4 *(P0)* **Import from URL**: paste a link → read the page's schema.org `Recipe` data (most recipe sites have it: Marmiton, CuisineAZ, 750g, Ricardo, BBC Good Food…) → preview.
- 7.5 *(P0)* **Fallback for pages without structured data**: send the page text through AI parsing (Claude API), as in 7.3.
- 7.6 *(P0)* **Share from the phone browser**:
  - Android: the installed app appears in the **share sheet** (Web Share Target), so Share → Recettes → preview.
  - iPhone: iOS doesn't let web apps receive shares, so we ship an **Apple Shortcut** ("Ajouter à Recettes") that appears in the share sheet and sends the URL to the app. Fallback: copy the link, open the app, and it offers to import the copied link.
- 7.7 *(P1)* Import from a **photo** (cookbook page, handwritten card) using Claude's vision.
- 7.8 *(P0)* Keep the **source** (URL or "Claude", plus the date) on the recipe, with a link back to the original.
- 7.9 *(P0)* Duplicate detection: "Une recette similaire existe déjà : Minestrone d'hiver. Remplacer / garder les deux ?"

### Epic 5: Settings (P1)
- 5.1 Manage aisles and their order.
- 5.2 Manage categories and seasons.
- 5.3 First day of the week, which meals to show (lunch only on weekends, etc.).
- 5.4 Export all data (JSON/CSV) as a backup.

### Epic 6: Notifications & extras (P2)
- 6.1 Notify the other phone when the list changes ("Eric ajouté : lait").
- 6.2 Sunday reminder: "Le menu de la semaine est vide".
- 6.3 Share a recipe as a link or image.
- 6.4 Dark mode.

## 5. MVP scope (v1)

Epics 1, 2 (2.1–2.5, 2.9), 3 (3.0–3.6), 4 (4.1–4.7) and 7 (7.1, 7.3–7.6, 7.8, 7.9).
Done when:
- a recipe found online or discussed with Claude is saved in **one action**;
- any recipe can be found by name or ingredient;
- picking the week's recipes produces the shopping list automatically;
- both phones shop together offline, and the Sheet is no longer needed.

## 6. Non-functional requirements

- Opens in under 2 s on a 4G connection; the shopping list opens instantly from the cache.
- Accessible: tap targets of 44 px or more, readable contrast, works in portrait.
- Data private to the household (row-level security on the backend).
- Automatic daily backup (backend) plus manual export.

## 7. Suggested milestones

1. **M0 – Setup**: repo, PWA skeleton, backend, auth, household. Deploy.
2. **M1 – Recipe book** + search.
3. **M2 – Capture**: parsing pipeline, URL import, paste text, Android share target + iOS Shortcut.
4. **M3 – Claude connector** (MCP server, `add_recipe`).
5. **M4 – Weekly basket/menu** + ideas.
6. **M5 – Shopping list** + offline + live sync. → **MVP, switch off the Sheet.**
7. **M6 – P1 items** (photos, photo import, more connector tools, settings, list period).
8. **M7 – P2 items.**

## 8. Decisions (2026-11-19)

1. **App type:** PWA (installable web app), no store app.
2. **Backend:** Supabase (free tier). The user creates the account.
3. **Accounts:** one account per person, both in the same household.
4. **Store:** one main store, with an aisle order that can be edited in Settings (starts from the default order).
5. **Meals:** lunch + dinner every day.
6. **Google Sheet data:** none to import, start fresh. → 2.8 dropped.
7. **AI parsing:** yes, a Claude API key is used (server side only, never in the app).
8. **Claude connector targets:** claude.ai web + Claude mobile app. The connector must be a remote MCP server reachable over HTTPS with OAuth. Check during M3 that the user's plan allows custom connectors.
