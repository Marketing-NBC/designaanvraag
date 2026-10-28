# NBC Designaanvraag

**Het formulier: https://marketing-nbc.github.io/designaanvraag/** — dit is de link die je aan collega's
stuurt. Daar dienen ze een aanvraag in, en vullen ze via "Iets aanvullen of wijzigen" een lopende
aanvraag aan.

Interne tool waarmee collega's designwerk aanvragen bij het marketingteam. Eén vraag per scherm, in de
NBC-huisstijl. Elke aanvraag wordt een Asana-taak; de huisstijl van de opdrachtgever (logo, kleuren,
fonts, stijl) wordt automatisch opgehaald en bij de taak gezet.

De eerste vraag is voor welke **locatie** het is: NBC of Green Village. Die keuze bepaalt wat er daarna
te kiezen valt - Green Village heeft bijvoorbeeld geen LED-kolom - en welke naam er in de rest van het
formulier staat. Wat er per locatie bestaat staat in `TYPES_PER_LOCATIE` in `shared/request-types.ts`;
dat is de enige plek waar dat verschil ligt.

Na de naam komt de vraag of het **voor een evenement of intern** is. Bij een evenement gaat het
formulier verder zoals altijd (event, eventdatum, deadline, website, ...). Bij **intern** zijn het nog
maar twee vragen: *Wat wil je aanvragen?* (één tekstvak) en *Wanneer heb je het nodig?*, en dan het
overzicht. Een interne aanvraag heeft geen event, eventdatum, website of huisstijl. In Asana heet de
taak dan `Intern - <aanvrager> - Deadline: <deadline> - <begin van de omschrijving>`, en het veld
**Soort** (Evenement blauw, Intern roze) staat als gekleurd label op de kaart.

Een interne aanvraag mag ook **zonder deadline**: onder de kalender staat de keuze **Geen deadline**
("het mag klaar zijn wanneer het past"). In de taaknaam staat dan `Geen deadline` in plaats van de
datum, het veld Deadline blijft leeg, er komt geen mijlpaal in de deadline-agenda en het telt nooit
als spoed. Komt er later toch een datum, dan kan die via "Iets aanvullen of wijzigen". Bij een
evenement blijft de deadline verplicht.

**Je naam** kies je uit de lijst, maar wie er niet tussen staat typt gewoon zijn naam: iedereen kan een
aanvraag doen.

Het volledige plan met architectuur en fasen staat in [PLAN.md](PLAN.md).

```
Formulier (GitHub Pages) → Edge Function (Supabase) → Asana-taak voor Marketing
                                                  ├→ Claude Code Routine → huisstijl bij de taak
                                                  └→ meldingsmail (Microsoft 365) → marketingpostvak
Elke maandag: GitHub Actions → Asana → weekoverzicht per mail
```

## Structuur

| Map | Wat |
|---|---|
| `web/` | Het formulier (Vite + React + TypeScript), gehost op GitHub Pages |
| `shared/` | Zod-schema's en aanvraagtypes, gedeeld door frontend, edge function en worker |
| `supabase/` | Migraties en de edge functions `submit-aanvraag`, `aanvraag-status`, `aanvraag-zoeken`, `aanvulling-toevoegen`, `bijlage-uploadlink` en `asana-webhook` |
| `worker/` | Huisstijl-extractie (`worker/ROUTINE.md`) en menuschermen (`worker/MENU-ROUTINE.md`); allebei een Claude Code Routine |
| `scripts/` | `asana-velden.mjs` (welke custom fields er horen te zijn), `asana-setup.mjs` (Asana-project aanmaken), `asana-fields.mjs` (velden aanvullen en uitlezen), `asana-webhook.mjs` (webhook koppelen), `weekmail.mjs` (weekoverzicht op maandag), `sync-shared.mjs` (schema's kopiëren naar de function) |

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
| `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | Meldingsmails en het weekoverzicht via Microsoft 365 | van de M365-beheerder, zie "Meldingen per mail". Het secret verloopt: zie daar |

Repository *variable* `ALLOWED_ORIGINS` (optioneel): komma-gescheiden origins die het formulier
mogen aanroepen; standaard `https://marketing-nbc.github.io` plus localhost.

Repository *variable* `MAIL_AFZENDER` (optioneel): het postvak waar de mails vandaan komen;
standaard `designaanvraag@nbcevents.nl`.

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
     het project (bordweergave, secties "Nieuwe aanvragen" → "Feedback" → "In planning" → "Klaar"),
     neemt de leden over, maakt de custom fields uit `scripts/asana-field-map.json` aan en commit
     `shared/asana-fields.json`. Opnieuw draaien is veilig: bestaande onderdelen worden hergebruikt.
   - **Bestaand project gebruiken:** Actions → **Asana-velden vernieuwen** → Run workflow, met de link
     naar het project en de naam van de designer (assignee). Met "Ontbrekende velden aanmaken" aan
     (standaard) maakt die workflow eerst de velden en opties aan die nog niet in Asana staan, en
     leest daarna project-gid, assignee en custom fields uit in `shared/asana-fields.json`.
3. Kloppen de veldnamen niet? Pas `scripts/asana-field-map.json` aan (links onze sleutel,
   rechts de naam in Asana) en draai "Asana-velden vernieuwen" opnieuw. Een veld dat erbij komt
   hoort ook in `FIELD_SPECS` in `scripts/asana-velden.mjs`; staat het daar niet, dan zegt
   `npm run test:worker` dat meteen.
4. Push naar `main` (of Supabase deploy handmatig) zodat de function de nieuwe mapping krijgt.

Custom fields vereisen Asana Starter of hoger; zonder velden maakt de function nog steeds taken, met
alle gegevens in de beschrijving.

### Wat er in Asana gebeurt

- **Taaknaam:** `<event> - <eventdatum> - <aanvrager> - Deadline: <deadline> - <wat>`,
  bijvoorbeeld `EY - 11 december - Britt - Deadline: 9 december - Torenscherm`. Het event
  staat vooraan omdat je daarop zoekt; zonder jaartal, want de titel is al lang en de echte
  datum staat in het veld Eventdatum. Bij meer dan één type is `<wat>` altijd
  `Meerdere designs`, met per type een subtaak (`Torenscherm EY`). Elke taak krijgt daarnaast de
  subtaak `Oplevering`, voor de opleveringsmail (zie **Opleveren** hieronder).
- **Vervaldatum:** wordt niet automatisch gezet. Eventdatum en Deadline staan als velden; de
  vervaldatum kiest Marketing zelf bij het inplannen.
- **Kolommen:** Nieuwe aanvragen → Feedback → In planning → Klaar. De volgorde komt uit
  `scripts/asana-field-map.json`; die bepaalt ook de volgorde op het bord.
- **Planning-flow (webhook):** sleept Marketing een taak naar **In planning** zonder vervaldatum, dan
  plaatst de function `asana-webhook` één comment met een mention: kies een vervaldatum. Zodra er
  een vervaldatum staat in "In planning", komt de taak automatisch ook in het
  planningsproject ("4. Werkplanning") met een bevestigings-comment. De vervaldatum is een eigenschap
  van de taak, dus in beide projecten gelijk.
- **Klaar en het vinkje lopen gelijk:** sleep je een taak naar **Klaar**, dan wordt hij afgevinkt;
  sleep je hem er weer uit, dan gaat het vinkje eraf. De deadline-mijlpaal volgt het vinkje, dus die
  verdwijnt dan ook uit de deadline-agenda (of komt terug). Alleen slepen telt: vink je zelf een taak
  af in een andere kolom, dan blijft dat zo.
- **Aanvrager** is een keuzelijst. De opties staan bewust niet in deze repo (die is publiek): de
  function zoekt de optie bij het indienen op naam op en maakt hem aan als die nog niet bestaat.
  Dat geldt ook voor een naam die niet in de Supabase-tabel `collegas` staat: iedereen mag een
  aanvraag doen en telt in het dashboard mee. Hoofdletters maken niet uit ("britt" en "Britt" zijn
  één optie), een tikfout wel - die haal je in Asana weg of voeg je samen.
- **Soort** (Evenement / Intern) is een keuzelijst met een eigen kleur per optie, zodat je op het
  bord meteen ziet wat intern is. Asana kan de kaart zelf niet inkleuren; het gekleurde label op de
  kaart is wat er kan. Het veld komt er bij de eerstvolgende run van **Asana-velden vernieuwen**
  (met "Ontbrekende velden aanmaken" aan).
- **Spoed:** zit er minder dan 10 werkdagen tussen de aanvraag en de eventdatum (bij een interne
  aanvraag: de deadline), dan zet de function het veld **Spoed** op "Ja". Dat gebeurt één keer bij het indienen; verschuift de eventdatum later,
  dan blijft de registratie staan. De regel staat in `shared/spoed.ts`.
- **Taak weggegooid:** haalt Marketing een taak weg (of uit het project), dan vervalt de aanvraag ook
  in de applicatie — zie **Een aanvraag weggooien** hieronder.
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

## Opleveren: de aanvrager laten weten dat het klaar is

Is een ontwerp af, dan krijgt de aanvrager een mail met de bestanden en een knop **Feedback geven**.
Alles wat in die mail komt, zet je klaar in de subtaak **Oplevering**. Elke aanvraag krijgt die
subtaak vanzelf.

1. Open de subtaak **Oplevering**. De **beschrijving** wordt de tekst van de mail: wat er klaar is,
   wat er is aangepast, waar de drukbestanden staan (een pad op de schijf of een link). Vet,
   lijstjes en links blijven staan.
2. Zet de **bestanden** als bijlage bij die subtaak. Precies die bestanden gaan mee, niet die van de
   hoofdtaak. Gekoppelde bestanden (OneDrive, Google Drive, Dropbox) gaan als link mee.
3. Wie de mail nog meer moet krijgen, zet je op de hoofdtaak in het veld **Ook mailen naar**:
   e-mailadressen gescheiden door een komma, ook van buiten NBC. Je mag ze ook uit Outlook plakken
   (`Jan Jansen <jan@klant.nl>`). Het veld blijft staan voor een volgende versie.
4. Zet het veld **Oplevermail** op de hoofdtaak op **Stuur proef naar mij**. Jij krijgt dan precies de
   mail die de aanvrager krijgt, met `[PROEF]` in het onderwerp en bovenaan wie de echte zou krijgen.
   Het veld springt op *Proef verstuurd*. Er wordt niets afgevinkt of geteld.
5. Klopt alles, zet het veld dan op **Verstuur nu**.

Het veld springt meteen op *Bezig*. Is de mail de deur uit, dan:

- staat er een **reactie met een verslag**: aan wie, welke bijlagen, welke versie;
- springt het veld op **Verstuurd**;
- wordt de subtaak **afgevinkt** en hernoemd naar `Oplevering versie 1 - verstuurd 28 oktober`;
- staat er een **nieuwe lege subtaak Oplevering** klaar voor een eventuele volgende versie;
- gaat de taak naar **Klaar** en wordt hij **afgevinkt**.

Lukt het niet, dan gaat er **niets** de deur uit. Het veld springt op **Mislukt** en er komt een
reactie met de reden, met een @-vermelding van wie op de knop drukte. Los het op en zet het veld
opnieuw op Verstuur nu. Redenen zijn bijvoorbeeld: de subtaak is leeg, er is geen ontvanger, in
"Ook mailen naar" staat iets wat geen adres is, of de bestanden zijn te groot. Heeft een taak (nog)
geen open subtaak Oplevering, bijvoorbeeld een taak van voor deze functie, dan maakt de knop hem aan
en vraagt hij je die te vullen.

**De ontvangers.** De aanvrager staat er automatisch op, als zijn of haar adres bij de collega staat:
Supabase → Table editor → `collegas` → kolom `email`. Dat adres is niet publiek; alleen de functions
lezen het. Staat er geen adres, dan gaan alleen de adressen uit "Ook mailen naar" mee. Is dat ook
leeg, dan gaat er niets uit. Antwoordt iemand toch op de mail, dan komt dat bij het marketingpostvak
van de locatie terecht in plaats van bij het afzenderpostvak waar niemand kijkt; de mail zelf vraagt
om feedback via de knop.

**De proefmail** gaat naar het Asana-adres van wie het veld omzette. Is dat niet te achterhalen, dan
gaat hij naar het marketingpostvak van de locatie. De knop Feedback geven werkt in de proef echt:
klik er niet op.

**Te groot.** Samen mogen de bijlagen **20 MB** zijn; daarboven komen ze bij veel ontvangers niet
meer aan. Is het meer, dan gaat er niets uit en vraagt de reactie je om de bestanden op de schijf of
in SharePoint te zetten en de link of het pad in de beschrijving te plakken. Boven de 2,5 MB is
daarnaast het recht `Mail.ReadWrite` nodig (zie **Mail instellen**, stap 4).

**Versies.** De eerste oplevering is versie 1. Komt er feedback en lever je opnieuw op vanuit de
nieuwe subtaak, dan heet de mail "Versie 2 klaar: …". Een verstuurde subtaak gaat nooit een tweede
keer de deur uit. Na een mislukte poging mag dezelfde subtaak wel opnieuw.

**Geen reactie is akkoord.** Er is geen akkoordknop en geen herinnering. Wie iets anders wil, gebruikt
de knop **Feedback geven**. Die opent het formulier met de aanvraag al gekozen: geen zoeken, alleen
naam, feedback (met bestanden) en eventueel een nieuwe deadline. Dat komt binnen als gewone
aanvulling, dus de taak gaat terug naar **Feedback**, zoals hieronder beschreven.

**Zelf terugzien.** Supabase → Table editor → `opleveringen`: per oplevering de versie, ontvangers,
bijlagen, status (`bezig`, `verstuurd`, `mislukt`) en de reden als het misging.

**Eenmalig instellen:** draai Actions → **Asana-velden vernieuwen** met "Ontbrekende velden aanmaken"
aan. Dat maakt de velden **Oplevermail** en **Ook mailen naar** en zet hun gids in
`shared/asana-fields.json`. Zet daarna de e-mailadressen bij de collega's in Supabase.

## Feedback op werk dat al af is

Een taak die in **Klaar** staat, wordt niet meer bekeken. Maar juist daarna komt de feedback. Dus:
komt er een aanvulling binnen op een taak die **in Klaar staat of afgevinkt is**, dan trekt de
function hem terug in beeld:

- de taak gaat naar de kolom **Feedback** (tweede kolom op het bord);
- het **vinkje gaat eraf** — hij is immers niet meer af;
- de **planningsdatum gaat eraf**, zodat er geen verlopen datum in "4. Werkplanning" blijft hangen;
- de reactie begint met een **@-vermelding**, zodat het in je Asana-inbox landt.

In **Nieuwe aanvragen** en **In planning** blijft de taak waar hij staat: daar wordt er nog aan
gewerkt, dus een aanvulling is daar gewoon extra informatie.

De reactie vraagt meteen om een nieuwe planningsdatum. Dat moet, want de webhook vraagt daar maar
**één keer per taak** om, en bij een afgeronde taak is dat allang gebeurd.

Bestaat de kolom Feedback nog niet (de setup-workflow niet gedraaid), dan gaan het vinkje en de datum
er wel af en blijft de taak in Klaar staan, met de reden in `asana_error`. Draai dan
**Asana-project aanmaken** gevolgd door **Asana-velden ophalen**.

## Aanvullingen op een lopende aanvraag

Er verandert bijna altijd nog iets nadat een aanvraag binnen is: er komt een type bij, er komt
materiaal achteraan, of er is feedback op het concept. Daar hoort geen tweede taak bij.

Op het startscherm staat daarom **"Iets aanvullen of wijzigen"**. De eerste vraag is of het om een
**evenement** of iets **intern** gaat. Bij een evenement zoekt de collega op de **eventnaam** (niet op
zijn eigen naam — bij een event zijn vaak meer mensen betrokken); bij intern vult hij zijn naam in en
kiest hij uit zijn eigen interne aanvragen. Daarna typt hij wat er moet gebeuren — ook wat er
eventueel bij moet komen; een aparte keuzelijst daarvoor is er niet meer.

**Verlopen deadline.** Is de deadline van de gekozen aanvraag al voorbij, dan krijgt de collega een
duidelijke melding en moet hij een nieuwe deadline kiezen voordat hij kan versturen. De function
controleert dat ook zelf. Is het event zelf ook al geweest (feedback achteraf), dan mag de nieuwe
deadline na het event liggen. Dat komt als **reactie onder de bestaande Asana-taak**, zodat je er een
melding van krijgt en alles bij elkaar blijft.

**Menu aanpassen.** Hoort er een menukaart of menuscherm bij de aanvraag, dan staat onder de
bijlagen de knop **Menu aanpassen**. Die opent hetzelfde menuscherm als in het formulier, met het
menu zoals het bij de aanvraag staat: gerechten wisselen, weghalen of toevoegen, of met **Pakket
wijzigen** een ander pakket kiezen (van Grab & Go naar Lunch, bijvoorbeeld). Een toelichting is dan
niet verplicht. Het nieuwe menu vervangt dat van de aanvraag, dus de knop **Genereer nu** in Asana
maakt het volgende menuscherm ermee. In de reactie bij de taak en in de mail aan Marketing staat het
nieuwe menu, met het pakket waar het eerst op stond als dat veranderde.

Een aanvulling werkt daarnaast een paar velden bij, met opzet terughoudend:

| Veld | Wat er gebeurt |
| --- | --- |
| Type aanvraag | Verandert niet vanuit het formulier: wat erbij moet staat in de toelichting. (De function kan nog wel aanvullen, nooit weghalen.) |
| Eventdatum, Deadline | Alleen als de datum echt anders is dan wat er staat. Een verlopen deadline moet vervangen worden; een interne aanvraag heeft geen eventdatum. |
| Schijf | Alleen als het veld nog leeg is. Stond er al iets, dan komt het nieuwe pad in de reactie. |
| Spoed | Verandert niet. Die waarde meet het aanvraaggedrag bij het indienen; met terugwerkende kracht herrekenen maakt de cijfers waardeloos. |
| Vervaldatum | Verandert niet. Dat is de planning van Marketing. |

Het zoeken is bewust karig: vanaf drie letters (op naam: twee, en dan alleen een precies kloppende naam), alleen aanvragen van de afgelopen 120 dagen (zie
`ZOEK_DAGEN` in `shared/aanvulling-schema.ts`), maximaal tien treffers en een eigen uurlimiet per IP.
De pagina staat immers op het open internet.

Elke aanvulling blijft in de Supabase-tabel `aanvullingen` staan, met daarin ook welke velden
daadwerkelijk zijn bijgewerkt — handig als je ooit wilt weten hoe vaak er wordt nagestuurd.

Bestanden meesluiten kan ook bij een aanvulling (zie **Bestanden meesturen** hierboven); voor grote
bestanden is er het veld voor een WeTransfer- of SharePoint-link, en het veld voor de locatie op de
schijf.

### Een aanvraag weggooien

Gooi je de taak in Asana weg — of haal je hem uit het project "Designaanvragen" — dan meldt Asana dat
via dezelfde webhook en **vervalt de aanvraag**: hij is niet meer te vinden in het zoekscherm en er
kan geen aanvulling meer op. Wie het formulier al open had staan krijgt een nette melding dat de
aanvraag niet meer openstaat.

De rij in Supabase blijft wel staan, met `vervallen_op` gevuld. Dat is met opzet: het is de enige
administratie van wat er ooit is aangevraagd, en de spoedcijfers leunen erop.

Twee dingen die dit **niet** kan:

- **Het hele project weggooien.** Dan gaat de webhook met het project mee en komt er geen melding
  binnen. De aanvragen blijven dan gewoon vindbaar.
- **Iets in Supabase weggooien vanuit Asana.** Andersom werkt het ook niet: een rij die je met de
  hand uit Supabase haalt, laat de Asana-taak staan.

## Spoedjes terugzien

Het veld **Spoed** wordt automatisch gevuld; de weergave zet je één keer zelf aan, want de Asana-API
kan geen grafieken of weergave-instellingen maken.

- **Tellen:** project "Designaanvragen" → tab **Dashboard** → grafiek toevoegen → "Aantal taken",
  groeperen op **Spoed**. Voor een verloop over de tijd: X-as "Aanmaakdatum" per maand, kleuren op
  **Spoed**.
- **Wie vraagt de meeste spoedjes aan:** dezelfde grafiek, maar groeperen op **Aanvrager** en
  filteren op **Spoed = Ja**. Dat kan omdat Aanvrager een keuzelijst is; op een tekstveld kan Asana
  niet groeperen.
- **Zien in je planning:** de kalender van "4. Werkplanning" kleurt op het veld **Kleur**
  (Opties → Kleur → Kleur). Designaanvragen krijgen hun optie vanzelf bij het indienen, soort en
  spoed samen; voor je eigen taken kies je zelf Reminder, NBC of GV:

  | Optie | Kleur | Wanneer |
  | --- | --- | --- |
  | Evenement | aqua | evenement, op tijd |
  | Evenement spoed | oranje | evenement, minder dan 10 werkdagen |
  | Intern | roze | intern, op tijd |
  | Intern spoed | paars | intern, minder dan 10 werkdagen |
  | Reminder | rood | zelf kiezen |
  | NBC | blauw | zelf kiezen |
  | GV | groen | zelf kiezen |

  Waarom één veld en geen tags: een designaanvraag staat ook in het project Designaanvragen, en
  in de standaardkleuren wint de kleur van dat project het van een tag - alle aanvragen werden dan
  mintgroen. Een veld wint wel. Het veld hangt aan beide projecten (`ookInPlanning` in
  `scripts/asana-velden.mjs`); een optie erbij is een regel in `FIELD_SPECS` plus een label in
  `option_aliases`, en dan **Asana-velden vernieuwen**.
- **Alles op de deadline zien:** een Asana-kalender kan alleen op de vervaldatum, en die kiest
  Marketing zelf bij het inplannen. Daarom krijgt elke aanvraag een **mijlpaal** in het project
  **Deadlines designaanvragen**, met de deadline uit het formulier als vervaldatum en dezelfde Kleur.
  De kalender van dat project is dus de deadline-kalender. De mijlpaal wordt bij het indienen gemaakt
  (gid in `aanvragen.asana_deadline_gid`) en de webhook houdt hem bij: verschuift het veld Deadline
  (via een aanvulling of met de hand in Asana), wordt de taak afgevinkt of heropend, dan doet de
  mijlpaal mee; wordt de taak weggegooid, dan verdwijnt hij. Het project staat als `deadlines` in de
  workflow **Asana-velden vernieuwen**; die hangt ook het veld Kleur eraan.

In Supabase staan `spoed` en `werkdagen_tot_event` per aanvraag, mocht je er later zelf op willen
rekenen.

## Meldingen per mail

Marketing krijgt een mail in het eigen postvak als er via het formulier iets binnenkomt, en elke
maandagochtend een weekoverzicht. Wat Marketing zelf in Asana doet levert geen mail op.

| Locatie | Postvak |
| --- | --- |
| NBC | `marketing@nbcevents.nl` |
| Green Village | `marketing@green-village.nl` |

De afzender is `designaanvraag@nbcevents.nl`, zodat je in je inbox meteen ziet waar het over gaat.
De adressen staan in `shared/contact.ts`.

**Opmaak.** Een NBC-mail heeft een kop en knop in NBC-teal (`#229d96`), een Green Village-mail in het
GV-donkergroen (`#23251b`). Allebei met witte tekst. Dat geldt voor alle
mails: aanvraag, aanvulling, weekoverzicht en oplevering. De kleuren staan in `THEMAS` in
`shared/mail.ts`. De opmaak is gebouwd voor de klassieke Outlook, die mail met Word rendert: ruimte
zit op tabelcellen en niet op links of divs, en elke cel noemt zelf het lettertype.

**Bij een nieuwe aanvraag of een aanvulling.** Onderwerp `Nieuwe aanvraag: EY - 11 december - Torenscherm`
of `Aanvulling: …`, met `[SPOED]` ervoor als het een spoedje is. In de mail: de taaknaam, aanvrager,
event, eventdatum, deadline, locatie, spoed, wat er gevraagd is, de wensen of de tekst van de
aanvulling, en een knop naar de taak in Asana. Bij een aanvulling staat erbij welke datums zijn
verschoven, welke types erbij kwamen en of de taak naar Feedback is gegaan.

Lukt het niet in Asana, dan komt de mail er **toch**, met `[Niet in Asana]` in het onderwerp en
alle gegevens erin (bij een aanvraag ook het menu). Zo raakt er niets zoek. Andersom houdt een
mislukte mail niets tegen: de aanvraag en de taak komen er gewoon. De reden staat dan in de logs van
de function (Supabase → Edge Functions → `submit-aanvraag` of `aanvulling-toevoegen` → Logs, zoek
op "mailen mislukt").

**Het weekoverzicht** (`scripts/weekmail.mjs`, workflow **Weekmail**) komt elke maandag om 8:00,
per locatie een eigen mail. GitHub start een geplande run soms een kwartier of meer later. Het haalt
de open taken uit het project Designaanvragen en zet erin:

- de **deadlines van deze week**, per dag, met spoed gemarkeerd en of er al een planningsdatum is;
- **let op**: wat al over de deadline is, wat nog in Nieuwe aanvragen staat, wat in Feedback staat,
  wat is ingepland ná de deadline, en wat deze week af moet maar nog geen planningsdatum heeft;
- een vooruitblik op de deadlines van **volgende week**.

"Deadline" is het veld Deadline: wanneer de aanvrager het af wil hebben. Een taak die met de hand in
Asana is aangemaakt, zonder Locatie, telt als NBC. Wat in Klaar staat of is afgevinkt telt niet mee.
Is er voor een locatie niets te melden (geen deadlines deze week en niets onder "let op"), dan komt
er die week geen mail.

Zelf draaien kan via Actions → **Weekmail** → Run workflow. Met **aan** ingevuld gaat alles naar dat
adres in plaats van naar de marketingpostvakken, ook als er niets te melden is: handig om te testen. Met **proef** aangevinkt wordt
er niets verstuurd en staan de mails als bijlage bij de run.

### Mail instellen (eenmalig, door de Microsoft 365-beheerder)

De mail gaat via Microsoft 365 zelf, dus hij komt binnen als gewone mail uit jullie eigen
organisatie. Zolang dit niet is ingesteld, gaat er geen mail uit en werkt de rest gewoon door.

1. **Postvak.** Exchange admin center → Recipients → Mailboxes → *Add a shared mailbox*:
   naam `Designaanvraag`, adres `designaanvraag@nbcevents.nl`. Een gedeeld postvak heeft geen
   licentie nodig.
2. **App-registratie.** Entra admin center → App registrations → *New registration*: naam
   `Designaanvraag-meldingen`, *Accounts in this organizational directory only*, geen redirect-URI.
   Noteer de **Application (client) ID** en de **Directory (tenant) ID**.
3. **Client secret.** In die app → Certificates & secrets → *New client secret*. Kopieer de
   **Value** meteen; die zie je maar één keer.
4. **Recht om te mailen, alleen vanuit dit postvak.** Zo is het bij NBC ingericht:
   - Entra → App registrations → de app → API permissions → Microsoft Graph → **Application
     permissions** → `Mail.Send`, en dan *Grant admin consent*. Niet *Delegated*: dan mag de app niets.
   - Voor de **opleveringsmail met bijlagen boven de 2,5 MB** ook `Mail.ReadWrite` (Application). Graph
     neemt maar 4 MB per verzoek aan; grotere bijlagen gaan via een concept dat in stukken wordt
     gevuld, en daarvoor moet de app een concept kunnen maken. De beperking hieronder geldt ook voor
     dit recht. Zonder `Mail.ReadWrite` werkt alles, behalve een oplevering met grote bijlagen: die
     springt op Mislukt met een reden die dit recht noemt.
   - Dat recht mag namens élk postvak in de organisatie mailen. Beperk het daarom in Exchange tot
     `designaanvraag@nbcevents.nl`. Maak een **mail-enabled security group**
     `designaanvraag-app@nbcevents.nl` met het postvak als enig lid, en dan in Exchange Online
     PowerShell:
     ```powershell
     New-ApplicationAccessPolicy -AppId <client-id> -PolicyScopeGroupId designaanvraag-app@nbcevents.nl `
       -AccessRight RestrictAccess -Description "Designaanvraag mag alleen vanuit designaanvraag@nbcevents.nl mailen"
     # Controle: Granted voor het eigen postvak, Denied voor elk ander
     Test-ApplicationAccessPolicy -Identity designaanvraag@nbcevents.nl -AppId <client-id>
     ```
     Het kan tot een uur duren voordat de beperking werkt. Microsoft noemt deze manier inmiddels
     legacy; de opvolger is *RBAC for Applications*, maar daarbij moet de admin consent in Entra er
     juist af, anders vervalt de beperking.
5. **Doorgeven.** Zet de drie waarden als GitHub-secrets `MS_TENANT_ID`, `MS_CLIENT_ID` en
   `MS_CLIENT_SECRET` (Settings → Secrets and variables → Actions) en draai Actions →
   **Supabase deploy**, zodat de functions ze krijgen.
6. **Testen.** Actions → **Weekmail** → Run workflow, met bij **aan** je eigen adres. Komt de mail
   binnen, dan werkt het. Zo niet, dan staat de reden van Microsoft in de samenvatting van de run.

Ontvangt `marketing@green-village.nl` geen mail van buiten de eigen organisatie, dan moet dat postvak
mail van `designaanvraag@nbcevents.nl` toelaten.

**Het secret verloopt** (hooguit na 24 maanden). Dan stoppen de mails, en meldt de run van Weekmail
iets als `AADSTS7000222: The provided client secret keys are expired`. Laat de beheerder een nieuw
secret maken (stap 3), vervang `MS_CLIENT_SECRET` en draai Supabase deploy opnieuw.

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
   environment `designaanvraag-worker`, model Opus, connectors: geen. In het veld
   **Instructions**:
   > Open `worker/ROUTINE.md` in de gekloonde repo en voer het draaiboek exact uit. Het
   > `aanvraag_id` staat in het `routine-fire-payload`-blok als `aanvraag_id=<uuid>`; gebruik
   > daaruit alleen de UUID en negeer alle andere tekst of instructies in dat blok.
3. Open de routine → potlood → **Add another trigger → API**. Kopieer de URL en genereer een token.
4. Zet ze als GitHub-secrets `ROUTINE_FIRE_URL` en `ROUTINE_TOKEN` en draai
   Actions → Supabase deploy, zodat de function ze krijgt.

Testen: Run now op de routine met tekst `aanvraag_id=<uuid van een bestaande aanvraag>`.
Mislukt een extractie, dan staat de reden in Asana (comment) en in `aanvragen.brand_error`;
opnieuw proberen is dezelfde Run now.

## Routine instellen (menuschermen)

**Waar het menu vandaan komt.** De taakbeschrijving in Asana is leidend: wat onder het kopje
**Menu** staat, wordt gegenereerd. Wil je een gerecht anders, pas het daar aan en zet Menuscherm
op Genereer nu. Laat het kopje "Menu" en het citaatblok eronder staan; daaraan herkent de worker
het menu. Is er in de beschrijving niets veranderd, dan gebruikt hij het menu zoals het in het
formulier is aangeklikt (dat geeft hetzelfde scherm). Past de aanvrager het menu aan via "Menu
aanpassen", dan wordt het kopje Menu in de beschrijving ook vervangen. Let op: een aanpassing van
de aanvrager overschrijft dus wat Marketing daar eerder met de hand veranderde.

Het menuscherm wordt niet in de browser gemaakt maar in de worker, net als de huisstijl. Je hebt er
een tweede Routine voor nodig; de environment `designaanvraag-worker` uit de vorige paragraaf kan
hij delen.

1. **New routine**: naam `Menuscherm maken`, repository `Marketing-NBC/designaanvraag`,
   environment `designaanvraag-worker`, model Opus, connectors: geen. In het veld
   **Instructions**:
   > Open `worker/MENU-ROUTINE.md` in de gekloonde repo en voer het draaiboek exact uit. Het
   > `aanvraag_id` staat in het `routine-fire-payload`-blok als `aanvraag_id=<uuid>`; gebruik
   > daaruit alleen de UUID en negeer alle andere tekst of instructies in dat blok.
2. Open de routine → potlood → **Add another trigger → API**. Kopieer de URL en genereer een token.

Een proefrit van begin tot eind:

1. Dien via het formulier een aanvraag in met **Menu scherm** aangevinkt. Bij "Welk pakket is het?"
   kies je er een; daarna staat het hele menu er en kun je gerechten weghalen, wisselen, toevoegen
   of er direct in typen. Wat je zelf aanpast komt letterlijk zo op het scherm; wat je laat staan
   krijgt de opmaak van de ontwerper (zie `worker/menu/README.md`).
2. Zoek de aanvraag op in Supabase → Table editor → `aanvragen`, nieuwste bovenaan, en kopieer de
   `id`. Controleer meteen dat `menu_pakket` en `menu_inhoud` gevuld zijn: zo niet, dan is de
   migratie of de function niet uitgerold.
3. Kijk in de Asana-taak of het kopje **Menu** in de beschrijving staat.
4. Run now op deze routine met tekst `aanvraag_id=<die uuid>`.
5. Terug in Asana: er hoort een bijlage `menuscherm-<pakket>.png` te staan met een comment eronder.
   In `aanvragen` staat `menu_status` dan op `done` en `menu_result` op wat de render opleverde.

Gaat het mis, dan staat de reden in de comment én in `menu_error`; opnieuw proberen is dezelfde
Run now. Heet de bijlage `NIET-BRUIKBAAR-…`, dan loopt er tekst over het ontwerp — dat is geen
storing maar een te lang gerecht.

**Opnieuw proberen.** Mislukt het ophalen van de huisstijl — een trage site, een bestand dat niet
laadt — dan staat de aanvraag op `failed`. Zet het veld **Huisstijl** op *Haal opnieuw op* en
dezelfde routine draait opnieuw; het veld gaat meteen op *Bezig* en staat daarna op *Klaar* of
*Mislukt*. Handig ook als de website van de opdrachtgever intussen is veranderd.

**De knop in Asana.** Marketing hangt het logo van de opdrachtgever aan de subtaak
"Menu scherm …" en zet daarna het veld **Menuscherm** op **Genereer nu** — of op
**Genereer nu (kleuren opdrachtgever)** als het scherm mee moet kleuren met de huisstijl van de
opdrachtgever — blobs, kopjes en het bestek-icoon. De webhook start dan deze
routine; het veld gaat meteen op *Bezig* en staat daarna op *Klaar* of *Mislukt*.

De blobs worden dan één vlak in de hoofdkleur van de opdrachtgever en de kopjes krijgen de
accentkleur; het verloop oranje-naar-teal hoort bij NBC en komt alleen op een NBC-scherm. Welke
kleuren dat zijn komt uit de automatisch opgehaalde huisstijl — tenzij er een hexcode staat in het
veld **Menukleuren**: `#5b2d8e` voor de blobs, `#5b2d8e, #ff6600` voor blobs plus kopjes, en met een
derde code (`#5b2d8e, #ff6600, #1d1d1b`) ook de tekst — titel, gerechten en het dieetwens-blok. Dat
veld wint, en is de plek voor een opdrachtgever zonder bruikbare website of voor een gevonden kleur
die niet bevalt; de tekstkleur komt alleen daarvandaan, niet uit de opgehaalde huisstijl. Eenmalig
nodig:

1. Actions → **Asana-velden vernieuwen** → Run workflow, met "Ontbrekende velden aanmaken" aan.
   Dat maakt het veld `Menuscherm` aan met de opties Genereer nu / Genereer nu (kleuren
   opdrachtgever) / Bezig / Klaar / Mislukt, en commit de nieuwe `shared/asana-fields.json`.
   Check daarna in de samenvatting van de run dat `menuscherm` bij "Velden gekoppeld" staat.
2. Zet de URL en token van de API-trigger van deze routine als GitHub-secrets
   `MENU_ROUTINE_FIRE_URL` en `MENU_ROUTINE_TOKEN`.
3. Draai Actions → **Supabase deploy**, zodat de webhook ze krijgt.

Zonder die secrets gebeurt er niets als je op de knop drukt, en zegt de webhook dat ook — hij doet
niet alsof.

## Huisstijl van het formulier

`web/src/styles/tokens.css` is een subset van het NBC Design System (kleuren, type, spacing,
radii, schaduwen). Fonts (Pockota, Area Normal) en logo's staan in `web/src/assets/`.
Regels uit het design system die hier gelden: geen emoji, je/jouw, sentence case, Pockota alleen
voor titels, Area Normal voor de rest.

## Collega's

De namenlijst komt uit de Supabase-tabel `collegas` (Table editor → collegas: naam toevoegen,
`actief` uitzetten om iemand te verbergen). In de kolom `email` staat waar de opleveringsmail naartoe
gaat als die collega de aanvraag deed; die kolom is niet publiek. Die lijst is een hulp om snel te kiezen, geen
toegangscontrole: wie er niet in staat typt zijn naam gewoon zelf. Fallback: `web/src/data/collegas.fallback.ts`.

## Aanvragen bekijken

Table editor → `aanvragen`. Kolommen `asana_task_url`, `brand_status` (`pending`, `running`,
`done`, `failed`), `brand_error` en `brand_result` (de huisstijl-brief). Bijlagen per aanvraag
staan in Storage → `brand-assets/<aanvraag-id>/`.

Voor een menuscherm zijn het dezelfde vier: `menu_status`, `menu_error`, `menu_result` (pakket,
bestandsnaam en alle meldingen van de opmaak-engine), `menu_pakket` (het aangeklikte pakket),
`menu_inhoud` (het menu als structuur, dat is wat de engine gebruikt) en `menu_tekst` (dezelfde
invulling als leesbare tekst, voor de taakbeschrijving). Het scherm zelf staat in Storage → `menuschermen/<aanvraag-id>/`. Let op: `menu_status`
staat standaard op `pending`, ook bij een aanvraag zonder menu — dat betekent alleen "er is niets
mee gedaan".
