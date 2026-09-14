# NBC Designaanvraag

Interne tool waarmee NBC-collega's designwerk aanvragen bij Abel. Eén vraag per scherm, in de
NBC-huisstijl. Elke aanvraag wordt een Asana-taak; de huisstijl van de klant (logo, kleuren,
fonts) wordt automatisch opgehaald en bij de taak gezet.

Het volledige plan met architectuur en fasen staat in [PLAN.md](PLAN.md).

## Structuur

| Map | Wat |
|---|---|
| `web/` | Het formulier (Vite + React + TypeScript), gehost op GitHub Pages |
| `shared/` | Zod-schema's en aanvraagtypes, gedeeld door frontend, backend en worker |
| `supabase/` | Database-migraties en edge functions (fase 2) |
| `worker/` | Huisstijl-extractie, draait in een Claude Code Routine (fase 3) |

## Lokaal draaien

```bash
npm install          # één keer, installeert alle workspaces
npm run dev          # http://localhost:5173
npm test             # unit tests (vitest)
npm run e2e          # end-to-end (Playwright, desktop + mobiel)
npm run build        # productie-build in web/dist
```

Zonder `VITE_SUPABASE_URL` en `VITE_SUPABASE_PUBLISHABLE_KEY` draait het formulier in
mock-modus: verzenden slaagt lokaal, er wordt niets opgeslagen. Zie `web/.env.example`.

## Deploy

Elke push naar `main` die `web/` of `shared/` raakt, bouwt en publiceert de site via
`.github/workflows/deploy-pages.yml`. Eenmalig nodig: **Settings → Pages → Source: GitHub Actions**.
De workflow probeert dit zelf aan te zetten; lukt dat niet, dan is dat één klik.

De site komt op `https://marketing-nbc.github.io/designaanvraag/`.

## Huisstijl

`web/src/styles/tokens.css` is een subset van het NBC Design System (kleuren, type, spacing,
radii, schaduwen). Fonts (Pockota, Area Normal) en logo's staan in `web/src/assets/`.
Regels uit het design system die hier gelden: geen emoji, je/jouw, sentence case, Pockota alleen
voor titels, Area Normal voor de rest.

## Collega's

De namenlijst komt uit de Supabase-tabel `collegas` (fase 2). Tot die tijd staat er een
fallback in `web/src/data/collegas.fallback.ts`.
