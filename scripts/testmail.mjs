#!/usr/bin/env node
/**
 * Een testmail: zo ziet een mail van het formulier eruit, met verzonnen gegevens. Alleen naar het
 * adres dat je opgeeft. Draait via .github/workflows/testmail.yml (Actions → Testmail versturen).
 *
 *   MS_TENANT_ID=... MS_CLIENT_ID=... MS_CLIENT_SECRET=... \
 *     node --experimental-strip-types scripts/testmail.mjs --aan jij@nbcevents.nl
 *
 * Opties:
 *   --aan <adres>        Verplicht: waar de testmail heen gaat.
 *   --mail <soort>       oplevering (standaard), oplevering-oud, herinnering of bevestiging.
 *                        oplevering-oud is de mail van een aanvraag van voor het akkoord.
 *   --locatie <locatie>  nbc (standaard) of green_village: bepaalt de kleuren.
 *   --proef              Niets versturen; de mail komt als HTML in testmail-proef/.
 *   --gif-basis <url>    Waar de gifjes online staan (zie shared/mail-gifs.ts). De workflow geeft de
 *                        map in de repo op de commit van de run. Welke gifjes er zijn, leest dit
 *                        script uit web/public/mail-gifs/ van dezelfde checkout, zodat een nieuw
 *                        gifje al vanaf een branch te testen is, voor het op Pages staat. Zonder
 *                        deze optie: de gifjes en de lijst op GitHub Pages.
 *
 * De knoppen in de mail wijzen naar een aanvraag die niet bestaat: wie erop klikt, krijgt in het
 * formulier te zien dat de aanvraag niet te vinden is. Zo kan een test nooit per ongeluk akkoord
 * geven op een echte aanvraag.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { renderHerinneringMail } from '../shared/akkoord.ts'
import { renderBevestigingMail } from '../shared/bevestiging.ts'
import { MELDING_AFZENDER, MELDING_ONTVANGERS } from '../shared/contact.ts'
import { createGraphMail, themaVoor, vulGifIn } from '../shared/mail.ts'
import { MAIL_GIF_BASIS, gifLijstVan } from '../shared/mail-gifs.ts'
import { leesGifs } from './mail-gifs.mjs'
import { beschrijvingAlsMailHtml, renderOpleveringMail } from '../shared/oplevering.ts'
import { vandaagInNl } from '../shared/spoed.ts'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'])
    return acc
  }, []),
)

function fail(msg) {
  console.error(`Fout: ${msg}`)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `❌ ${msg}\n`)
  process.exit(1)
}

const proef = args.proef === 'true'
const aan = args.aan && args.aan !== 'true' ? String(args.aan).trim() : ''
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(aan)) fail('Geef met --aan een geldig mailadres op.')
const soort = String(args.mail && args.mail !== 'true' ? args.mail : 'oplevering')
const SOORTEN = ['oplevering', 'oplevering-oud', 'herinnering', 'bevestiging']
if (!SOORTEN.includes(soort)) fail(`Onbekende mail "${soort}". Kies uit: ${SOORTEN.join(', ')}.`)
const locatie = args.locatie === 'green_village' ? 'green_village' : 'nbc'
const eigenGifs = args['gif-basis'] && args['gif-basis'] !== 'true' ? String(args['gif-basis']) : null
const gifs = eigenGifs
  ? { lijst: async () => leesGifs().lijst, basis: eigenGifs }
  : { lijst: gifLijstVan(MAIL_GIF_BASIS), basis: MAIL_GIF_BASIS }

// Verzonnen, en bestaat niet: zie boven.
const AANVRAAG_ID = '00000000-0000-4000-8000-000000000000'
const antwoordAan = [MELDING_ONTVANGERS[locatie] ?? MELDING_ONTVANGERS.nbc]
const over14dagen = vandaagInNl(new Date(Date.now() + 14 * 24 * 3600 * 1000))
const voorbeeld = {
  soort: 'evenement',
  event: 'Testevent',
  eventDatum: over14dagen,
  omschrijving: '',
  types: ['led_kolom', 'torenscherm'],
  andersTekst: '',
}

let bericht
if (soort === 'oplevering' || soort === 'oplevering-oud') {
  bericht = renderOpleveringMail({
    ...voorbeeld,
    aan: [aan],
    antwoordAan,
    aanvraagId: AANVRAAG_ID,
    versie: 1,
    locatie,
    berichtHtml: beschrijvingAlsMailHtml('<body>Hoi!\n\nHierbij de designs voor de LED-kolom en het torenscherm. '
      + 'Laat maar weten of het zo goed is.</body>', themaVoor(locatie)),
    afzenderNaam: 'Marketing',
    aanvrager: 'de aanvrager',
    akkoord: soort === 'oplevering',
    bijlagen: [{ naam: 'Testevent - LED-kolom.jpg', bytes: 1_240_000 }, { naam: 'Testevent - Torenscherm.jpg', bytes: 2_080_000 }],
    links: [],
  })
} else if (soort === 'herinnering') {
  bericht = renderHerinneringMail({
    ...voorbeeld,
    aan: [aan],
    antwoordAan,
    aanvraagId: AANVRAAG_ID,
    locatie,
    versie: 1,
    verstuurdOp: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    nummer: 1,
    aanvrager: 'de aanvrager',
  })
} else {
  bericht = renderBevestigingMail({
    aanvraag: {
      locatie, soort: 'evenement', naam: 'Test', event: voorbeeld.event, event_datum: over14dagen,
      deadline: vandaagInNl(new Date(Date.now() + 7 * 24 * 3600 * 1000)), aanvraag_types: voorbeeld.types,
      anders_tekst: '', omschrijving: 'Dit is een testaanvraag.', menu_taal: 'nl',
    },
    aanvraagId: AANVRAAG_ID,
    aan,
    antwoordAan: antwoordAan[0],
  })
}
bericht = { ...bericht, aan: [aan], onderwerp: `Test: ${bericht.onderwerp}` }

if (proef) {
  bericht = { ...bericht, html: vulGifIn(bericht.html, await gifs.lijst(), gifs.basis) }
  mkdirSync('testmail-proef', { recursive: true })
  writeFileSync(`testmail-proef/${soort}-${locatie}.html`, bericht.html)
  console.log(`(proef) ${bericht.onderwerp} → testmail-proef/${soort}-${locatie}.html`)
  process.exit(0)
}

const ms = { tenantId: process.env.MS_TENANT_ID, clientId: process.env.MS_CLIENT_ID, clientSecret: process.env.MS_CLIENT_SECRET }
if (!ms.tenantId || !ms.clientId || !ms.clientSecret) fail('MS_TENANT_ID, MS_CLIENT_ID en MS_CLIENT_SECRET zijn nodig om te mailen.')
try {
  await createGraphMail({ ...ms, afzender: process.env.MAIL_AFZENDER || MELDING_AFZENDER, gifs }).verstuur(bericht)
} catch (e) {
  fail(`Versturen mislukt: ${e instanceof Error ? e.message : String(e)}`)
}
// Het adres komt niet in de samenvatting: die is te zien voor iedereen met toegang tot de repo.
const regel = `Testmail verstuurd: ${bericht.onderwerp}`
console.log(regel)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `✅ ${regel}\n`)
