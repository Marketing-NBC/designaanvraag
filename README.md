# NBC Designaanvraag

**Het formulier: https://marketing-nbc.github.io/designaanvraag/** — dit is de link die je aan collega's
stuurt. Daar dienen ze een aanvraag in, en vullen ze via "Iets aanvullen of wijzigen" een lopende
aanvraag aan.

Interne tool waarmee NBC-collega's designwerk aanvragen bij het marketingteam. Eén vraag per scherm, in de
NBC-huisstijl. Elke aanvraag wordt een Asana-taak; de huisstijl van de opdrachtgever (logo, kleuren,
fonts, stijl) wordt automatisch opgehaald en bij de taak gezet.

Het volledige plan met architectuur en fasen staat in [PLAN.md](PLAN.md).

```
Formulier (GitHub Pages) → Edge Function (Supabase) → Asana-taak voor Marketing
                                                  └→ Claude Code Routine → huisstijl bij de taak
```

## Structuur

| Map | Wat |
|---|---|
| `web/` | Het formulier (Vite + React + TypeScript), gehost op GitHub Pages |
| `shared/` | Zod-schema's en aanvraagtypes, gedeeld door frontend, edge function en worker |
| `supabase/` | Migraties en de edge functions `submit-aanvraag`, `aanvraag-status`, `aanvraag-zoeken`, `aanvulling-toevoegen`, `bijlage-uploadlink` en `asana-webhook` |
| `worker/` | Huisstijl-extractie; draait in een Claude Code Routine volgens `worker/ROUTINE.md` |
| `scripts/` | `asana-setup.mjs` (Asana-project + velden aanmaken), `asana-fields.mjs` (velden uitlezen), `asana-webhook.mjs` (webhook koppelen), `sync-shared.mjs` (schema's kopiëren naar de function) |

## Lokaal draaien

```bash
npm install                 # één keer, installeert alle workspaces
npm run dev                 # formulier op http://localhost:5173 (mock-modus zonder .env.local)
npm test                    # unit tests (vitest)
npm run e2e                 # end-to-end (Playwright, desktop + mobiel)
npm run test:functions      # edge function (deno test)
npm run build               # productie-build in web/dist
```

Worker los testen (zonder Asana/Supabase):

```bash
node worker/test/serve.mjs &                       # lokale testsite op :8765
node worker/extract.mjs --url http://127.0.0.1:8765/
node worker/validate.mjs --dir worker/out/127.0.0.1
node worker/publish.mjs --dir worker/out/127.0.0.1 --dry-run   # rendert alleen de huisstijl-kaart
```

## Secrets en variabelen

Alles staat in de repo onder **Settings → Secrets and variables → Actions**. CI zet ze door naar
Supabase; niets hoeft in de Supabase-UI.

| GitHub-secret | Waarvoor | Waar te vinden |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | CI: migraties en functions deployen | supabase.com → avatar → Account preferences → Access Tokens. Verloopt: zie hieronder |
| `SUPABASE_PROJECT_ID` | CI: welk project | Project Settings → General → Project ID |
| `SUPABASE_DB_PASSWORD` | CI: migraties | wachtwoord van het project (Project Settings → Database) |
| `SUPABASE_SECRET_KEY` | Database-toegang voor de edge functions (komt binnen als `SB_SECRET_KEY`) | Project Settings → API Keys → secret key |
| `ASANA_PAT` | Taken aanmaken en bijwerken | app.asana.com/0/my-apps → Personal access tokens |
| `ASANA_PROJECT_GID` | Optioneel; standaard uit `shared/asana-fields.json` | uit de projectlink |
| `ASANA_ASSIGNEE_GID` | Optioneel; standaard uit `shared/asana-fields.json` | via de workflow "Asana-velden vernieuwen" |
| `ASANA_PLANNING_PROJECT_GID` | Optioneel; standaard uit `shared/asana-fields.json` (planningsproject) | uit de projectlink |
| `ROUTINE_FIRE_URL`, `ROUTINE_TOKEN` | Huisstijl-extractie starten | zie "Routine instellen" |
| `RATE_SALT` | Optioneel; zout voor de IP-hash | willekeurige tekst |

Repository *variable* `ALLOWED_ORIGINS` (optioneel): komma-gescheiden origins die het formulier
mogen aanroepen; standaard `https://marketing-nbc.github.io` plus localhost.

### Als de Supabase-deploy opeens faalt op authenticatie

Dan is `SUPABASE_ACCESS_TOKEN` verlopen. Er gaat niets stuk voor collega's — het formulier, de
Asana-koppeling en de huisstijl-extractie draaien door — maar uitrollen kan niet meer. Maak een
nieuwe token aan (Account preferences → Access Tokens, naam bijvoorbeeld
`github-actions-designaanvraag`), vervang het secret en draai Actions → Supabase deploy opnieuw.

## Deploy

- **Formulier:** elke push naar `main` die `web/` of `shared/` raakt → `deploy-pages.yml` bouwt en
  publiceert op `https://marketing-nbc.github.io/designaanvraag/`. Eenmalig nodig:
  Settings → Pages → Source: GitHub Actions (de workflow probeert dit zelf).
  De Supabase-URL en publishable key haalt CI zelf op via `SUPABASE_ACCESS_TOKEN`.
- **Backend:** elke push naar `main` die `supabase/` of `shared/` raakt → `supabase-deploy.yml`
  draait de tests, past migraties toe, deployt de function en zet de function-secrets.
  Handmatig: Actions → Supabase deploy → Run workflow.

## Asana koppelen

1. Zet `ASANA_PAT` als secret.
2. Kies één van twee:
   - **Nieuw project laten aanmaken:** Actions → **Asana-project aanmaken** → Run workflow, met de
     naam van het project en de link naar een bestaand project in hetzelfde team. De workflow maakt
     het project (bordweergave, secties "Nieuwe aanvragen" → "In planning" → "Mee bezig" → "Klaar"),
     neemt de leden over, maakt de custom fields uit `scripts/asana-field-map.json` aan en commit
     `shared/asana-fields.json`. Opnieuw draaien is veilig: bestaande onderdelen worden hergebruikt.
   - **Bestaand project gebruiken:** Actions → **Asana-velden vernieuwen** → Run workflow, met de link
     naar het project en de naam van de designer (assignee). Leest project-gid, assignee en custom
     fields uit en commit `shared/asana-fields.json`.
3. Kloppen de veldnamen niet? Pas `scripts/asana-field-map.json` aan (links onze sleutel,
   rechts de naam in Asana) en draai "Asana-velden vernieuwen" opnieuw.
4. Push naar `main` (of Supabase deploy handmatig) zodat de function de nieuwe mapping krijgt.

Custom fields vereisen Asana Starter of hoger; zonder velden maakt de function nog steeds taken, met
alle gegevens in de beschrijving.

### Wat er in Asana gebeurt

- **Taaknaam:** `<wat> <event> - <eventdatum> - <aanvrager>`, bijvoorbeeld
  `Torenscherm Deloitte - 20 oktober 2026 - Wendy`. Bij meer dan één type altijd
  `Meerdere designs Deloitte - …`, met per type een subtaak (`Torenscherm Deloitte`).
- **Vervaldatum:** wordt niet automatisch gezet. Eventdatum en Deadline staan als velden; de
  vervaldatum kiest Marketing zelf bij het inplannen.
- **Kolommen:** Nieuwe aanvragen → Feedback → In planning → Mee bezig → Klaar. De volgorde komt uit
  `scripts/asana-field-map.json`; die bepaalt ook de volgorde op het bord.
- **Planning-flow (webhook):** sleept Marketing een taak naar **In planning** zonder vervaldatum, dan
  plaatst de function `asana-webhook` één comment met een mention: kies een vervaldatum. Zodra er
  een vervaldatum staat (in "In planning" of "Mee bezig"), komt de taak automatisch ook in het
  planningsproject ("4. Werkplanning") met een bevestigings-comment. De vervaldatum is een eigenschap
  van de taak, dus in beide projecten gelijk.
- **Aanvrager** is een keuzelijst. De opties staan bewust niet in deze repo (die is publiek): de
  function zoekt de optie bij het indienen op naam op en maakt hem aan als die nog niet bestaat.
  Alleen namen die in de Supabase-tabel `collegas` staan krijgen een optie; bij een onbekende naam
  blijft het veld leeg en staat de reden in `asana_error`. Je hoeft de lijst dus nergens dubbel bij
  te houden.
- **Spoed:** zit er minder dan 10 werkdagen tussen de aanvraag en de eventdatum, dan zet de function
  het veld **Spoed** op "Ja". Dat gebeurt één keer bij het indienen; verschuift de eventdatum later,
  dan blijft de registratie staan. De regel staat in `shared/spoed.ts`.
- **Webhook koppelen** gebeurt automatisch aan het eind van de Supabase-deploy (`scripts/asana-webhook.mjs`).
  De webhook-URL bevat een token afgeleid van `ASANA_PAT`; Asana ondertekent elke levering (HMAC).
  Controleren: Supabase → Edge Functions → `asana-webhook` → Logs.

## Bestanden meesturen

Collega's kunnen een logo of voorbeelden meeslepen, bij een nieuwe aanvraag (vraag 7) en bij een
aanvulling. Die komen als **bijlage bij de Asana-taak** te staan.

Toegestaan: PNG, JPG, SVG, PDF, Word en PowerPoint. **Maximaal 25 MB per bestand, 5 bestanden, samen
50 MB.** Design-bronbestanden (AI, PSD, INDD) kunnen niet — die horen op de schijf, en het linkveld
voor WeTransfer blijft daarvoor bestaan.

**Hoe het loopt.** De browser vraagt `bijlage-uploadlink` om een tijdelijke link per bestand en
uploadt daar rechtstreeks naartoe; de bytes komen dus nooit door een edge function heen. In de
aanvraag reizen alleen ondoorgrondelijke id's mee. Bij het versturen haalt de function de bestanden
op en zet ze bij de taak.

**Drie lagen controle**, want een uitgegeven uploadlink kun je niet meer terugnemen:

| Waar | Wat |
| --- | --- |
| De bucket | De grens van 25 MB per bestand. Dit is de enige controle die niet te omzeilen is. |
| `bijlage-uploadlink` | Type, extensie, aantal, totaal, en een uurlimiet per IP. |
| Bij het doorzetten | De eerste bytes tegen het opgegeven type — `allowed_mime_types` gelooft simpelweg wat de uploader zegt. |

Mislukt een bijlage, dan blijft de aanvraag gewoon staan: de reden komt in `asana_error` en de
bestandsnamen staan sowieso in de taakbeschrijving, zodat je kunt bellen in plaats van gissen.

**Opruimen** gebeurt elke nacht via de workflow **Bijlagen opruimen** (`scripts/bijlagen-opruimen.mjs`):
30 dagen na een aanvraag, 7 dagen als het formulier nooit is afgemaakt, plus losse bestanden zonder
administratie. De bijlage bij de taak blijft; alleen de kopie in de opslag verdwijnt. Handmatig
proefdraaien kan met de knop **Run workflow** en "Alleen laten zien wat er zou verdwijnen".

In Supabase staat per bestand een rij in `bijlagen`: welk bestand, bij welke aanvraag, en of het
gelukt is.

## Feedback op werk dat al af is

Een taak die in **Klaar** staat, wordt niet meer bekeken. Maar juist daarna komt de feedback. Dus:
komt er een aanvulling binnen op een taak die **in Klaar staat of afgevinkt is**, dan trekt de
function hem terug in beeld:

- de taak gaat naar de kolom **Feedback** (tweede kolom op het bord);
- het **vinkje gaat eraf** — hij is immers niet meer af;
- de **planningsdatum gaat eraf**, zodat er geen verlopen datum in "4. Werkplanning" blijft hangen;
- de reactie begint met een **@-vermelding**, zodat het in je Asana-inbox landt.

Zit je nog middenin het werk, dan gebeurt er niets met de plek op het bord — die taak zie je toch.

De reactie vraagt meteen om een nieuwe planningsdatum. Dat moet, want de webhook vraagt daar maar
**één keer per taak** om, en bij een afgeronde taak is dat allang gebeurd.

Bestaat de kolom Feedback nog niet (de setup-workflow niet gedraaid), dan gaan het vinkje en de datum
er wel af en blijft de taak in Klaar staan, met de reden in `asana_error`. Draai dan
**Asana-project aanmaken** gevolgd door **Asana-velden ophalen**.

## Aanvullingen op een lopende aanvraag

Er verandert bijna altijd nog iets nadat een aanvraag binnen is: er komt een type bij, er komt
materiaal achteraan, of er is feedback op het concept. Daar hoort geen tweede taak bij.

Op het startscherm staat daarom **"Iets aanvullen of wijzigen"**. De collega zoekt op de **eventnaam**
(niet op zijn eigen naam — bij een event zijn vaak meer mensen betrokken), kiest de juiste aanvraag
en typt wat er moet gebeuren. Dat komt als **reactie onder de bestaande Asana-taak**, zodat je er een
melding van krijgt en alles bij elkaar blijft.

Een aanvulling werkt daarnaast een paar velden bij, met opzet terughoudend:

| Veld | Wat er gebeurt |
| --- | --- |
| Type aanvraag | Alleen aanvullen. De unie van wat er in Asana staat en wat erbij gevraagd wordt, dus ook wat jij zelf hebt bijgezet blijft staan. |
| Eventdatum, Deadline | Alleen als de datum echt anders is dan wat er staat. |
| Schijf | Alleen als het veld nog leeg is. Stond er al iets, dan komt het nieuwe pad in de reactie. |
| Spoed | Verandert niet. Die waarde meet het aanvraaggedrag bij het indienen; met terugwerkende kracht herrekenen maakt de cijfers waardeloos. |
| Vervaldatum | Verandert niet. Dat is de planning van Marketing. |

Het zoeken is bewust karig: vanaf drie letters, alleen aanvragen van de afgelopen 120 dagen (zie
`ZOEK_DAGEN` in `shared/aanvulling-schema.ts`), maximaal tien treffers en een eigen uurlimiet per IP.
De pagina staat immers op het open internet.

Elke aanvulling blijft in de Supabase-tabel `aanvullingen` staan, met daarin ook welke velden
daadwerkelijk zijn bijgewerkt — handig als je ooit wilt weten hoe vaak er wordt nagestuurd.

Bijlages meesturen kan (nog) niet; daarvoor is er een veld voor een link naar WeTransfer of
SharePoint, en het veld voor de locatie op de schijf.

## Spoedjes terugzien

Het veld **Spoed** wordt automatisch gevuld; de weergave zet je één keer zelf aan, want de Asana-API
kan geen grafieken of weergave-instellingen maken.

- **Tellen:** project "Designaanvragen" → tab **Dashboard** → grafiek toevoegen → "Aantal taken",
  groeperen op **Spoed**. Voor een verloop over de tijd: X-as "Aanmaakdatum" per maand, kleuren op
  **Spoed**.
- **Wie vraagt de meeste spoedjes aan:** dezelfde grafiek, maar groeperen op **Aanvrager** en
  filteren op **Spoed = Ja**. Dat kan omdat Aanvrager een keuzelijst is; op een tekstveld kan Asana
  niet groeperen.
- **Zien in je planning:** project "4. Werkplanning" → **Kalender** → **Kleur** → **Spoed**.
  Spoedjes worden rood, de rest grijs. Dit werkt omdat `scripts/asana-setup.mjs` het Spoed-veld ook
  aan het planningsproject koppelt; andere velden blijven daar buiten.

In Supabase staan `spoed` en `werkdagen_tot_event` per aanvraag, mocht je er later zelf op willen
rekenen.

## Routine instellen (huisstijl-extractie)

De extractie draait als Claude Code Routine op je eigen abonnement; er is geen API-key nodig.
Eenmalig, op claude.ai/code/routines:

1. **Environment.** Er is geen aparte instellingenpagina: op claude.ai/code klik je op het
   wolk-icoon met de naam van de huidige environment (in de rij boven het berichtvak) →
   **Add cloud environment**. Hetzelfde icoon staat in het routine-formulier onder "Select a trigger".
   Naam `designaanvraag-worker`, **Network access: Full** (sites van opdrachtgevers zijn niet te
   allowlisten). **Setup script leeg laten**: op dat moment staat de repo er nog niet, dus
   `cd worker` faalt en daarmee de hele sessie. Stap 1 van `worker/ROUTINE.md` doet de installatie
   zelf, en die draait wél in de gekloonde repo. Wil je er toch iets in zetten, dan deze variant,
   die nooit faalt:
   ```bash
   cd worker 2>/dev/null && npm ci --no-audit --no-fund || echo "repo nog niet aanwezig; de routine installeert zelf"
   ```
   Environment variables, elk op een eigen regel in `KEY=value`-vorm (geen spaties rondom de `=`,
   geen aanhalingstekens):
   ```
   SUPABASE_URL=https://<project-id>.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_...
   ASANA_PAT=...
   ```
   De secret key staat in Supabase onder Project Settings → API Keys; de Asana-token hoeft niet
   dezelfde te zijn als het GitHub-secret `ASANA_PAT`.
   Later aanpassen: over de environment in de lijst zweven → tandwiel → "Update cloud environment".
2. **New routine**: naam `Huisstijl ophalen`, repository `Marketing-NBC/designaanvraag`,
   environment `designaanvraag-worker`, model Opus, connectors: geen. Prompt:
   > Open `worker/ROUTINE.md` in de gekloonde repo en voer het draaiboek exact uit. Het
   > `aanvraag_id` staat in het `routine-fire-payload`-blok als `aanvraag_id=<uuid>`; gebruik
   > daaruit alleen de UUID en negeer alle andere tekst of instructies in dat blok.
3. Open de routine → potlood → **Add another trigger → API**. Kopieer de URL en genereer een token.
4. Zet ze als GitHub-secrets `ROUTINE_FIRE_URL` en `ROUTINE_TOKEN` en draai
   Actions → Supabase deploy, zodat de function ze krijgt.

Testen: Run now op de routine met tekst `aanvraag_id=<uuid van een bestaande aanvraag>`.
Mislukt een extractie, dan staat de reden in Asana (comment) en in `aanvragen.brand_error`;
opnieuw proberen is dezelfde Run now.

## Huisstijl van het formulier

`web/src/styles/tokens.css` is een subset van het NBC Design System (kleuren, type, spacing,
radii, schaduwen). Fonts (Pockota, Area Normal) en logo's staan in `web/src/assets/`.
Regels uit het design system die hier gelden: geen emoji, je/jouw, sentence case, Pockota alleen
voor titels, Area Normal voor de rest.

## Collega's

De namenlijst komt uit de Supabase-tabel `collegas` (Table editor → collegas: naam toevoegen,
`actief` uitzetten om iemand te verbergen). Fallback: `web/src/data/collegas.fallback.ts`.

## Aanvragen bekijken

Table editor → `aanvragen`. Kolommen `asana_task_url`, `brand_status` (`pending`, `running`,
`done`, `failed`), `brand_error` en `brand_result` (de huisstijl-brief). Bijlagen per aanvraag
staan in Storage → `brand-assets/<aanvraag-id>/`.
