# Plan: NBC Designaanvraag-tool

## Context

NBC-collega's vragen designwerk aan bij designer Abel. Dat gaat nu ad hoc. We bouwen een interne
webpagina (Typeform-achtig, één vraag per scherm) waarmee een aanvraag in ~2 minuten is ingevuld.
Elke aanvraag wordt automatisch een Asana-taak voor Abel, inclusief een automatisch opgehaalde
huisstijl (logo, kleuren, fonts, stijlnotities) van de opgegeven klant-/eventwebsite. Stap 3
(menukaarten automatisch opmaken in Claude Design) is een latere fase; dit plan legt alleen de
haakjes daarvoor.

Repo `Marketing-NBC/designaanvraag` is leeg en **privé**. Branch: `claude/serene-johnson-ob9w7m`.

## Vastgelegde keuzes (uit je antwoorden)

| Onderwerp | Keuze |
|---|---|
| Stijl | NBC Design System-export (`NBC_Design_System.zip`, aangeleverd door Devi; komt in `web/` en `docs/design-system/`) |
| Hosting | GitHub Pages, geen login |
| Opslag | Supabase (aanvragen + collega's), Asana als output voor Abel |
| Huisstijl-extractie | Eigen scraper + Claude API (geen Brandfetch/logo.dev) |
| Asana | Bestaand project met custom fields (veldnamen lever jij aan) |

## Architectuur

GitHub Pages is puur statisch, dus tokens (Asana, Claude, GitHub) kunnen nooit in de browser.
Daarom drie lagen:

```
Browser (GitHub Pages, Vite/React)
   │  POST /functions/v1/submit-aanvraag   (publishable key in `apikey`-header)
   ▼
Supabase Edge Function  submit-aanvraag
   ├─ valideert (zod), honeypot, rate-limit, idempotency
   ├─ INSERT aanvragen (secret key, bypasst RLS)
   ├─ Asana: POST /tasks  → taak voor Abel (custom fields, html_notes, due_on)
   ├─ GitHub: POST /repos/…/dispatches  (event_type: brand-extract, {aanvraag_id, website_url})
   └─ → { aanvraag_id, asana_task_url, brand_dispatched: bool }
                       │
                       ▼
GitHub Actions worker  brand-extract.yml   (Node 22 + Playwright/Chromium + sharp)
   ├─ laadt website, screenshots, computed styles, logo-kandidaten, fonts, kleuren
   ├─ Claude API (vision + structured output → brand-brief JSON)
   ├─ Asana: attachments (logo, huisstijl-kaart.png, screenshot) + html_notes aanvullen + comment
   └─ Supabase: brand_status/brand_result + assets in Storage (input voor fase Claude Design)
```

Waarom een GitHub Actions-worker en niet alles in de Edge Function: Edge Functions hebben geen
browser, 2 s CPU-tijd en geen `sharp`. Computed styles + screenshot geven Claude veel betere input
dan regex over CSS. Actions is gratis (2.000 min/maand op privé repo's; een run kost ~3 min).
Doorlooptijd dispatch → klaar is 2–4 min; het succes-scherm zegt daarom "huisstijl volgt binnen
±5 minuten in de Asana-taak".

## Repo-layout

```
web/                          Vite + React + TS (frontend), base '/designaanvraag/'
  public/fonts/               Pockota + Area Normal (uit DS-export)
  public/brand/               nbc-logo-*.png, nbc-logo-mark.svg, hero-event (verkleind, ≤400KB)
  src/styles/tokens.css       = colors_and_type.css uit de DS (font-paths aangepast)
  src/styles/base.css         reset, layout, focus, motion
  src/lib/{storage,api,dates}.ts
  src/data/requestTypes.ts    LED-kolom … Anders (labels + keys, gedeeld met shared/)
  src/components/             Shell, ProgressBar, StepCounter, Question, TextField, UrlField,
                              Combobox, DateField, ChoiceList (single/multi + letters), OtherInput,
                              TextArea, NavButtons, Review, Success, ResumeBanner
  src/steps.tsx               stap-definities (vraag, component, validatie, conditie)
  src/App.tsx                 state-machine + keyboard nav + AnimatePresence
shared/
  aanvraag-schema.ts          zod-schema (dependency-light; gebruikt door web, function, worker)
  request-types.ts            keys + labels
  asana-fields.json           gegenereerd: custom-field gids + enum-option gids (committed)
scripts/
  asana-fields.ts             genereert shared/asana-fields.json uit het Asana-project
supabase/
  config.toml                 [functions.submit-aanvraag] verify_jwt = false
  migrations/0001_init.sql    aanvragen, collegas (+ view), rate_limits (+ sql-functie), storage bucket, RLS
  functions/_shared/          asana.ts, github.ts, notes.ts (html_notes renderer), ratelimit.ts
  functions/submit-aanvraag/index.ts
  functions/aanvraag-status/index.ts   (GET status voor succes-scherm; M4)
worker/
  package.json, src/index.ts  CLI: --aanvraag-id <id> | --url <site> --dry-run
  src/extract/{page,logo,colors,fonts}.ts
  src/claude/brief.ts         structured output met zod-schema BrandBrief
  src/kaart/{template.html,render.ts}   huisstijl-kaart via Playwright → PNG
  src/asana/{attach,notes,comment}.ts
  src/supabase.ts
.github/workflows/
  deploy-pages.yml            build web → GitHub Pages
  brand-extract.yml           on: repository_dispatch [brand-extract] + workflow_dispatch (aanvraag_id | url)
  supabase-deploy.yml         db push + functions deploy bij wijzigingen in supabase/
README.md                     runbook: secrets, Asana-setup, collega's beheren, handmatig opnieuw draaien
```

## Fase 1: Formulier (frontend)

**Stack:** Vite, React 19, TypeScript, plain CSS met DS-tokens (geen Tailwind: het DS is
CSS-variable-gebaseerd), `framer-motion` (stap-transities), `zod`, `react-day-picker` + `date-fns`
(nl-locale, week start maandag), `@headlessui/react` Combobox (a11y). Eén route, geen router
(voorkomt 404's op Pages).

**Look & feel (NBC DS, `README.md` + `colors_and_type.css` uit de export):**
- Pagina `#f1f1ef`, tekst `#21282b`, display in Pockota (Light/Regular, swash `ss01`), body Area Normal.
- Topbar: NBC-wordmark (kleur, zonder pay-off) links, dunne 4px voortgangsbalk in teal `#229d96`.
- Stapnummer als ornament in Pockota: `03 / 09` (DS-regel: slash-paginering met voorloopnul).
- Vraag: Pockota `--t-title-sm` (38px, sentence case). Hulptekst: Area Normal `--fg-secondary`.
- Inputs: DS-veldstijl (`#fafafa`, 1px `#d9e0e2`, radius 8px, 21px tekst). Textarea idem.
- Keuze-opties: kaarten (radius 8px, border `#c8c5c1`, hover lift −2px, geselecteerd = teal-tint
  `#d3ebea` + ink-border) met letterbadge `A`…`H` links (Typeform-patroon).
- Primaire knop: pill, ink `#0e0e0e`, wit, `Volgende →`, met hint "druk op Enter ↵".
- Start-scherm: donker `#050606` met `hero-event` foto + gradient, display-kop "Designaanvraag",
  subkop "Vertel ons wat je nodig hebt. Abel gaat ermee aan de slag.", knop "Start →".
- Succes-scherm: teal-gradient (`#a8d8d5 → #e9f5f4`), "Gelukt." in Pockota display.
- Easing `cubic-bezier(.22,1,.36,1)`, 400ms; `prefers-reduced-motion` respecteren.
- Geen emoji, je/jouw, sentence case (DS-regels). Favicon = `nbc-logo-mark.svg`.

**Referenties uit Mobbin die we volgen:** Typeform (nummer + pijl vóór vraag, letter-badges,
"press Enter"-hint, ↑↓-navigatie rechtsonder), Remote/Navattic (stappenlabel + optiekaarten),
Dribbble (icoon + progressline boven de vraag).

**Stappen en validatie (zod, in `shared/aanvraag-schema.ts`):**

| # | Vraag | Component | Validatie |
|---|---|---|---|
| 1 | Hoe heet je? | Combobox met zoeken (collega's uit Supabase) | verplicht, uit lijst |
| 2 | Voor welk event is het? | kort tekstveld | 2–120 tekens |
| 3 | Wanneer is het event? | kalender, huidige maand, ← → | ≥ vandaag |
| 4 | Wanneer heb je het uiterlijk nodig? | kalender | ≥ vandaag, ≤ eventdatum; zachte waarschuwing bij < `MIN_LEAD_DAYS` (config, default 5 werkdagen) |
| 5 | Wat is de website van het bedrijf of het event? | URL-veld, auto `https://` | geldige URL met TLD |
| 6 | Waar op de schijf vind ik meer informatie of bestaande designs? | tekstveld, placeholder `G:\Events\2026\…` | optioneel |
| 7 | Wat wil je aanvragen? | multi-select A–H, H = "Anders, namelijk…" met inline invoer | ≥ 1; bij H tekst verplicht |
| 8 | Volledig custom of standaard designs? | 2 kaarten (radio) | verplicht |
| 9 | Omschrijf je wensen of bijzonderheden | textarea (Shift+Enter = nieuwe regel) | optioneel, max 3000 |
| 10 | Klopt dit? | overzicht met "wijzig" per regel | — |
| 11 | Gelukt. | Asana-link, status huisstijl, "Nieuwe aanvraag" | — |

**Interactie:** Enter = volgende (in textarea Cmd/Ctrl+Enter), ↑/↓-knoppen rechtsonder,
letters A–H togglen opties (alleen op keuzestappen), focus naar de vraag bij stapwissel +
`aria-live`, inline foutmelding onder het veld (`--nbc-error`), autosave in localStorage
(banner "Verder waar je gebleven was?"), werkt op 400px breed. Verborgen velden voor de backend:
honeypot, `started_at`, `client_request_id` (UUID, idempotent bij dubbelklik/retry).

**Deploy:** `deploy-pages.yml` (push naar `main` → `npm ci && npm run build` →
`actions/upload-pages-artifact` → `actions/deploy-pages`). `VITE_SUPABASE_URL` en
`VITE_SUPABASE_PUBLISHABLE_KEY` als repo-variables.
**Let op:** Pages op een privé repo vereist GitHub Team/Enterprise voor de org. Kan dat niet,
dan is de fallback **Cloudflare Pages** (gratis, deployt vanaf een privé repo; rest van het plan
onveranderd) of de repo public maken. Dit checken we als eerste in M1.

## Fase 2: Backend (Supabase + Asana)

**Schema (`0001_init.sql`):**
- `aanvragen(id uuid pk, created_at, client_request_id uuid unique, naam, event, event_datum date,
  deadline date, website text, schijf_locatie text, aanvraag_types text[], anders_tekst text,
  design_modus text check in ('custom','standaard'), omschrijving text, asana_task_gid text,
  asana_task_url text, brand_status text default 'pending' check in ('pending','running','done','failed'),
  brand_result jsonb, brand_error text, brand_updated_at timestamptz, ip_hash text)`
  — RLS aan, **geen policies**: alleen de secret key (function + worker) kan lezen/schrijven.
- `collegas(id, naam text unique, actief bool default true, volgorde int)` + view
  `collegas_public(naam)` met `SELECT`-policy `using (actief)`; beheer in de Supabase-UI zonder deploy.
  Geen namen in de repo (alleen een lege fallback).
- `rate_limits(key text, window_start timestamptz, count int, pk(key, window_start))` + SQL-functie
  `bump_rate_limit(key, window)` (`INSERT … ON CONFLICT DO UPDATE SET count = count+1 RETURNING count`,
  atomisch). Limieten: `ip:<sha256(ip+salt)>` 10/uur **en** `global` 100/dag (beschermt Actions-minuten
  en Claude-kosten). IP = eerste waarde van `x-forwarded-for`.
- Storage bucket `brand-assets` (privé) voor logo's/brief per aanvraag.

**Edge Function `submit-aanvraag` (Deno, `verify_jwt = false`, publishable key in `apikey`-header,
`supabaseAdmin` met secret key):**
1. CORS alleen voor `ALLOWED_ORIGIN` (Pages-domein) + localhost; `OPTIONS` afhandelen.
2. Honeypot gevuld of `started_at` < 5 s geleden → 200 zonder actie. Rate-limit check.
3. Valideer met gedeeld zod-schema. Bestaand `client_request_id` → zelfde response teruggeven.
4. Insert rij (status `pending`).
5. Asana `POST /tasks`:
   - `name`: `Aanvraag <types, komma-gescheiden> – <event>` (bv. `Aanvraag LED-kolom, Vlaggen – Congres Zorg 2026`)
   - `projects: [ASANA_PROJECT_GID]`, `assignee: ASANA_ASSIGNEE_GID` (Abel), `due_on: deadline`
     (één due date per taak; eventdatum gaat alleen in het custom field)
   - `custom_fields`: gids uit `shared/asana-fields.json` (gegenereerd door `scripts/asana-fields.ts`
     via `GET /projects/{gid}/custom_field_settings`; hernoemde velden = script opnieuw draaien).
     Waardevormen: enum → option-gid, multi_enum → array van option-gids, date → `{ "date": "YYYY-MM-DD" }`,
     text → string. Ontbrekend veld/optie → overslaan en loggen, nooit de aanvraag laten falen.
   - `html_notes` via `_shared/notes.ts`: `<body>`-wrapper, XML-valid, alleen toegestane tags
     (`h1 h2 strong em a ul li blockquote hr img`; geen tabellen, alleen `<a>` mag attributen):
     aanvrager, event, datums (nl-format), website-link, schijflocatie als `<code>`, aanvraag,
     modus, wensen als `<blockquote>`, sectie `<h2>Huisstijl</h2>` met markerregel
     "Wordt automatisch opgehaald…". Faalt de notes-validatie → fallback naar platte `notes`.
6. Update rij met `asana_task_gid/url`.
7. Synchroon (≈300 ms) `POST https://api.github.com/repos/Marketing-NBC/designaanvraag/dispatches`
   `{event_type:"brand-extract", client_payload:{aanvraag_id, website_url}}` met fine-grained PAT
   (**Contents: write**). Dispatch-fout → `brand_status='failed'` + `brand_error`, aanvraag slaagt wel;
   response meldt `brand_dispatched:false` zodat het succes-scherm eerlijk is.
8. Response `{ aanvraag_id, asana_task_url, brand_dispatched }`.

**Secrets (Supabase):** `ASANA_PAT`, `ASANA_PROJECT_GID`, `ASANA_ASSIGNEE_GID`,
`GITHUB_DISPATCH_TOKEN`, `ALLOWED_ORIGIN`, `RATE_SALT`.

## Fase 3: Huisstijl-extractie worker (GitHub Actions)

**Workflow `brand-extract.yml`:** `on: repository_dispatch: types: [brand-extract]` +
`workflow_dispatch` (inputs `aanvraag_id` of `url` + `dry_run`). Moet op `main` staan.
`concurrency: brand-${{ aanvraag_id }}`, `timeout-minutes: 10`, Playwright-browsers gecachet.
Secrets: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ASANA_PAT`, `ANTHROPIC_API_KEY`.

**Stappen in `worker/src/index.ts`:**
1. Rij ophalen, `brand_status='running'`. URL valideren (publiek IP, geen linktree/facebook/instagram).
2. **Browser (`extract/page.ts`):** Chromium 1440×900, `nl-NL`, realistische UA,
   `--disable-blink-features=AutomationControlled`, `reducedMotion`, animaties uit.
   `waitUntil:'load'`, stapsgewijs naar beneden scrollen (lazy load), terug naar boven.
   Cookiebanner: selectorlijst (OneTrust, Cookiebot, `.cc-btn`, "Accepteren/Alles accepteren/
   Akkoord/Accept all"), daarna resterende `position:fixed` overlays (>20 % viewport) verbergen;
   `[id*=cookie],[class*=consent]` uitsluiten van kleursampling.
   Screenshots: hero 1440×900, full page (max 4000px), header-crop op 2×.
3. **Logo (`extract/logo.ts`, top 4 op score):** `header/nav/[role=banner]/a[href="/"]`-nakomelingen
   (`img`, `svg`, `picture`, CSS-background), zichtbaar, top ≤ 200px, breedte 40–600px, bonus voor
   "logo"/merknaam in `alt/class/src/id`; JSON-LD `Organization.logo`; `apple-touch-icon`,
   SVG-`icon`, `og:image` (laag), `favicon.ico` (laatste). Per kandidaat **origineel** ophalen via
   `page.request.get` (SVG heeft Abels voorkeur) **én** een element-screenshot op 2× met
   `omitBackground` als universele fallback (sprites, inline SVG, webp/avif, CSS-backgrounds).
   avif → PNG via `sharp` (Claude accepteert jpeg/png/gif/webp).
4. **Kleuren (`extract/colors.ts`):** computed `color/background-color/border-color` van body,
   h1–h3, p, a, buttons, header/nav/footer + 200 grootste zichtbare elementen, gewogen op
   oppervlak, geclusterd (RGB-afstand ~12), accent-bonus voor buttons/links; CSS custom properties
   met `color|primary|secondary|accent|brand` (cross-origin sheets: CSS-tekst ophalen + regex);
   `meta theme-color` + manifest `theme_color`; screenshot-histogram (`sharp` quantize) alleen als
   cross-check met beperkt gewicht.
5. **Fonts (`extract/fonts.ts`):** `document.fonts.ready` → geladen families/weights; computed
   `font-family` van h1/h2/p/body/button met `document.fonts.check()`; Google Fonts-links,
   `@font-face`-namen, Typekit-id; Arial/Helvetica/system-ui markeren als "generiek".
6. **Claude (`claude/brief.ts`):** model `claude-opus-5` (env `BRAND_MODEL`, alternatief
   `claude-sonnet-5`), `effort: medium`. Bij implementatie de `claude-api`-skill laden. Structured
   output (`messages.parse` + `zodOutputFormat(BrandBriefSchema)`), zelfde zod-schema valideert
   `brand_result`. Afbeeldingen vóór de tekst, gelabeld ("Image 1: hero", "Image 2: header",
   "Image 3–6: logo-kandidaten"), daarna JSON met signalen. Schema:
   `{ brand_name, logo:{candidate_index, reason, prefers_dark_bg}, colors:[{hex, role:primary|secondary|accent|background|text, name, source}], fonts:{heading:{family,weight,source,fallback}, body:{…}}, style_notes:[…] (NL, 3–5 punten), confidence:0–1, warnings:[…] }`.
   Kosten ≈ $0,15–0,20 per aanvraag (Opus) / $0,06 (Sonnet); bij tientallen aanvragen per maand verwaarloosbaar.
7. **Huisstijl-kaart (`kaart/`):** HTML-template (NBC-tokens; logo, swatches met hex + rol,
   fontnamen in de echte webfont als die van Google komt, 3 stijlnotities, domein, datum) →
   Playwright-screenshot → `huisstijl-kaart.png` 1600×1000.
8. **Asana:** `POST /attachments` (multipart `parent`+`file`, ≤100MB) voor logo-origineel,
   huisstijl-kaart, hero-screenshot → gids. Daarna `GET` huidige `html_notes`, de markerregel
   onder `<h2>Huisstijl</h2>` vervangen (of sectie achteraan toevoegen als de marker weg is) met:
   kleuren als `<ul>` (hex + rol), fonts, notities, `<img data-asana-gid="…">` van de kaart,
   confidence + waarschuwingen; `PUT` de volledige notes. Comment via
   `POST /tasks/{gid}/stories` (`html_text`: alleen tekst + `<a>`; geen img/h1) zodat Abel een
   notificatie krijgt.
9. **Supabase:** `brand_status='done'`, `brand_result`, assets naar Storage `brand-assets/<aanvraag_id>/`.
10. **Fouten:** 403/challenge/timeout → fallback plain `fetch` + HTML-regex (icons, og:image,
    inline kleuren, Google Fonts) → Claude met `confidence: low` + warning. Alles mislukt →
    `brand_status='failed'` + Asana-comment "Huisstijl kon niet automatisch worden opgehaald:
    <reden>. Website: <url>" + link om de workflow handmatig opnieuw te draaien. Nooit stil falen.

## Fase 4 (later, buiten dit plan): menukaart/menuscherm → Claude Design

Claude Design heeft geen API. Haakjes die we nu al leggen: `aanvraag_types` bevat
`menukaart_print`/`menu_scherm`, brand-brief + logo staan in Storage, en `steps.tsx` ondersteunt
conditionele stappen zodat "Plak de menu-inhoud" later één regel is.

## Wat ik van jou nodig heb (in volgorde van urgentie)

1. **Collega-namen** (lijst) — gaan in Supabase, niet in de repo.
2. **Asana:** PAT (service-account of jouw account), project-GID, Abels user-GID, en de
   **namen + types** van de custom fields (datum/enum/multi-enum/tekst) met hun opties.
   Een testproject is prettig voor M2/M3.
3. **Supabase-project** (URL, publishable key, secret key, access token + db-wachtwoord voor CI),
   of nodig me uit in je account.
4. **Anthropic API key** voor de worker.
5. **GitHub:** fine-grained PAT op deze repo (Contents: write; max 366 dagen op org-tokens, dus
   reminder); Pages inschakelen (Settings → Pages → Source: GitHub Actions); bevestigen dat de org
   Pages op privé repo's mag (Team-plan), anders kiezen we Cloudflare Pages.
6. **Doorlooptijd Abel** (default 5 werkdagen) voor de zachte waarschuwing bij de deadline.

## Risico's en keuzes

- **Fonts op een publieke site:** Pockota/Area Normal worden geserveerd vanaf de Pages-URL (zoals
  op nbccongrescentrum.nl zelf). Repo blijft privé, dus broncode/namen zijn niet publiek.
- **GitHub Pages + privé repo** vereist Team/Enterprise. Fallback: Cloudflare Pages.
- **Sites die headless blokkeren** (Cloudflare-challenges): fallback op plain fetch; in het
  uiterste geval een nette melding in Asana + handmatige re-run.
- **Asana `html_notes` is strikt XML:** renderer escapet alles; fout in notes blokkeert nooit de taak.
- **Beveiliging zonder login:** CORS-origin, honeypot, tijdcheck, rate-limit per IP + globaal
  dagplafond, idempotency, alle secrets server-side. Een gedeelde toegangscode kan later in één env var.
- **Supabase-keys:** nieuwe stijl (`sb_publishable_…`/`sb_secret_…`); legacy anon/service-role
  JWT's worden eind 2026 uitgefaseerd.

## Verificatie

- **Frontend:** `vitest` voor schema en stap-logica; Playwright e2e tegen `vite preview`
  (Chromium is hier voorgeïnstalleerd): hele flow via toetsenbord, validatiefouten, autosave,
  overzicht, mocked submit; screenshots desktop + 400px voor visuele check tegen het DS.
- **Edge function:** `deno test` met gemockte fetch (Asana, GitHub); lokaal draaien via
  `deno run` + curl (geen Docker hier). Daarna echte call naar het Asana-testproject: taak, custom
  fields, notes, due date, assignee kloppen.
- **Worker:** `npm run extract -- --url <site> --dry-run` op 3 sites (schrijft brief +
  `huisstijl-kaart.png` lokaal, geen Asana/Supabase); daarna `workflow_dispatch` op GitHub met
  echte secrets en controle van de Asana-taak (bijlagen, inline kaart, comment).
- **End-to-end:** aanvraag via de Pages-URL → Asana-taak binnen 5 s → huisstijl binnen ±5 min.

## Milestones (volgorde van bouwen)

1. **M1 Formulier** — repo-skelet, DS-tokens/fonts/assets, alle stappen, validatie, keyboard,
   autosave, overzicht, succes-scherm met mock; `deploy-pages.yml`; live op Pages (of Cloudflare)
   voor jouw review.
2. **M2 Backend** — migratie, `submit-aanvraag` (insert + rate-limit + idempotency), frontend aan
   echte endpoint, collega's uit Supabase, `supabase-deploy.yml`.
3. **M3 Asana** — `scripts/asana-fields.ts`, taak aanmaken met custom fields + notes, dispatch
   naar GitHub → **v1 live** (aanvragen komen bij Abel).
4. **M4 Huisstijl-worker** — `brand-extract.yml`, browser-extractie, Claude-brief, kaart,
   Asana-update, Storage, failed-pad met re-run.
5. **M5 Afwerking** — `aanvraag-status` endpoint + live status op succes-scherm, README/runbook,
   logging, laatste DS-polish.
