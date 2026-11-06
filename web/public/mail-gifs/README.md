# Gifjes in de mails

Elke mail van het designaanvraag-formulier heeft bovenaan een gifje, willekeurig gekozen uit de map
van die mail:

| Map | Mail | Naar |
| --- | --- | --- |
| `bevestiging` | Je aanvraag is binnen | de aanvrager |
| `oplevering` | Je design staat klaar | de aanvrager |
| `herinnering` | Wacht op je akkoord | de aanvrager |
| `nieuwe-aanvraag` | Nieuwe aanvraag | Marketing |
| `aanvulling` | Aanvulling | Marketing |
| `akkoord` | Akkoord gegeven | Marketing |
| `weekoverzicht` | Weekoverzicht op maandag | Marketing |

NBC en Green Village gebruiken dezelfde gifjes.

Een opleveringsmail van een **torenscherm** bij NBC krijgt geen gifje: daar staat het design op de foto
van het torenscherm (zie *Torenscherm-preview* in de README van de repository). Lukt die preview niet,
dan komt er toch een gifje uit `oplevering`.

## Een gifje toevoegen

1. Zoek een gifje, bijvoorbeeld op [tenor.com](https://tenor.com) of [giphy.com](https://giphy.com),
   en sla het op als **`.gif`**. Let op: rechtsklikken en "Afbeelding opslaan" geeft op Giphy vaak
   een `.webp`. Gebruik daar de knop **Download** en kies GIF.
2. Geef het bestand een naam die zegt wat erop staat, zoals `mr-bean-waiting.gif`. De naam staat
   in de mail als het plaatje niet laadt.
3. Open op GitHub de juiste map hieronder, klik **Add file → Upload files**, sleep het gifje erin en
   klik **Commit changes** (op `main`).

Binnen een paar minuten staat het online en gaat het mee in de mails. Je kunt volgen hoe ver het is
onder **Actions → Deploy naar GitHub Pages**. Een gifje weghalen gaat net zo: open het bestand, klik
op de drie puntjes en kies **Delete file**.

**Grootte maakt niet uit.** Bij het online zetten wordt een gifje dat te groot is vanzelf kleiner
gemaakt: hooguit 480 × 360 px en rond de 900 KB. Het bestand hier blijft zoals het is.

**Het eerste beeldje telt.** De klassieke Outlook op Windows laat alleen het eerste beeldje van een gif
zien. Kies er een waarvan dat beeldje ook los iets laat zien.

## Testen voor het live gaat

Wil je eerst zien hoe een gifje overkomt, zet het dan op een eigen branch in plaats van op `main`, en
stuur jezelf een testmail via **Actions → Testmail versturen**. Kies bij "Use workflow from" die
branch. De testmail pakt de gifjes van die branch.

## Hoe het werkt

De gifjes zitten niet ín de mail: ze staan op GitHub Pages en de mail verwijst ernaar. De mail wordt
er dus niet groter van en het kost niets. Bij elke deploy maakt `scripts/mail-gifs.mjs` een lijst
(`gifs.json`) van wat er in de mappen staat; die haalt de mail bij het versturen op. Lukt dat niet,
dan gaat de mail zonder gifje. De code staat in `shared/mail-gifs.ts`.
