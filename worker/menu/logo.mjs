/**
 * Het logo van de opdrachtgever ophalen uit Asana.
 *
 * Marketing hangt het logo als bijlage aan de subtaak van het menuscherm. Pas als
 * het er staat kan het scherm gemaakt worden: zonder logo staat er een rode
 * plaatshouder en dat gaat niet de deur uit. De worker wacht dus liever dan dat
 * hij iets oplevert wat toch opnieuw moet.
 *
 * Waarom bij de subtaak en niet bij de hoofdtaak: aan de hoofdtaak hangen ook de
 * bestanden die de collega bij zijn aanvraag meestuurde - een briefing, een
 * plattegrond, een foto. Dat is geen logo. De subtaak is een lege plek die maar
 * voor een ding bedoeld is.
 */
import sharp from 'sharp'
import { downloadAttachment, getAttachments, getSubtasks } from '../lib/asana.mjs'
import { isMenuSubtaak, MENU_SUBTAAK_NAMEN } from '../../shared/asana-title.ts'

// Wat de browser als afbeelding kan zetten. Een PDF, EPS of .ai kan dat niet: dat
// zijn drukwerkbestanden en daar moet iemand eerst een PNG van maken.
const BEELDSOORTEN = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

// Ruim boven wat een logo nodig heeft (het staat op hoogstens zo'n 1200 pixels op een
// 4K-scherm), maar klein genoeg om niet met een foto van 8 MB de pagina in te gaan.
const MAX_BREEDTE = 2000

const extensie = (naam) => String(naam).toLowerCase().split('.').pop()

/** Is dit een bestand dat we als logo kunnen zetten? */
export function bruikbaarAlsLogo(bijlage) {
  return Object.hasOwn(BEELDSOORTEN, extensie(bijlage?.name ?? ''))
}

/**
 * Welke bijlage is het logo?
 *
 * Staat er "logo" in de naam, dan is dat hem - ook als er meer bijlagen hangen.
 * Anders de nieuwste bruikbare. Hangt er niets bruikbaars, dan geven we terug
 * wat er wel hing, zodat de melding kan zeggen wat eraan scheelt.
 */
export function kiesLogo(bijlagen) {
  const bruikbaar = (bijlagen ?? []).filter(bruikbaarAlsLogo)
  if (!bruikbaar.length) return { logo: null, onbruikbaar: bijlagen ?? [] }
  const opNaam = bruikbaar.filter((b) => /logo/i.test(b.name))
  const kandidaten = opNaam.length ? opNaam : bruikbaar
  const nieuwste = [...kandidaten].sort(
    (a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0]
  return { logo: nieuwste, onbruikbaar: [], meerdere: kandidaten.length > 1 }
}

/**
 * Maakt van een bijlage een data-URI die de opmaak-engine kan zetten.
 * Een te groot beeld wordt verkleind; een SVG blijft zoals hij is.
 */
export async function logoDataUri(bijlage) {
  return (await logoBeeld(bijlage)).uri
}

/**
 * Het logo als data-URI, met de maat waarop het scherm hem moet zetten.
 *
 * De marge rondom gaat eraf. Wie een logo exporteert laat daar vaak witruimte in
 * staan, en zonder bijsnijden telt die marge mee als logo: het beeld wordt dan
 * kleiner naarmate iemand ruimer heeft geexporteerd. Dat is geen keuze van de
 * ontwerper maar een toevalligheid van het bestand.
 *
 * Een SVG snijden we niet bij - daar zit geen rasterrand in om te meten, en de
 * viewBox is meestal al strak. De maten komen dan uit de viewBox zelf.
 *
 * @returns {{uri, breedte, hoogte, vector, bron}}
 */
export async function logoBeeld(bijlage) {
  const soort = BEELDSOORTEN[extensie(bijlage.name)]
  if (!soort) throw new Error(`"${bijlage.name}" is geen afbeelding die wij kunnen zetten.`)

  if (soort === 'image/svg+xml') {
    const maat = await sharp(bijlage.buffer).metadata().catch(() => null)
    return {
      uri: `data:${soort};base64,${bijlage.buffer.toString('base64')}`,
      breedte: maat?.width ?? 1, hoogte: maat?.height ?? 1, vector: true,
      bron: { breedte: maat?.width ?? 0, hoogte: maat?.height ?? 0 },
    }
  }

  const oorspronkelijk = await sharp(bijlage.buffer).metadata()
  let beeld = sharp(bijlage.buffer).trim({ threshold: 6 })
  let buffer = await beeld.png().toBuffer().catch(() => null)
  // Een logo dat helemaal uit een kleur bestaat snijdt sharp tot niets weg; dan
  // houden we het bestand zoals het was.
  if (!buffer) buffer = await sharp(bijlage.buffer).png().toBuffer()
  let maat = await sharp(buffer).metadata()
  if (!maat.width || !maat.height) {
    buffer = await sharp(bijlage.buffer).png().toBuffer()
    maat = await sharp(buffer).metadata()
  }
  if (maat.width > MAX_BREEDTE) {
    buffer = await sharp(buffer).resize({ width: MAX_BREEDTE }).png().toBuffer()
    maat = await sharp(buffer).metadata()
  }
  return {
    uri: `data:image/png;base64,${buffer.toString('base64')}`,
    breedte: maat.width, hoogte: maat.height, vector: false,
    bron: { breedte: maat.width, hoogte: maat.height,
            voorBijsnijden: { breedte: oorspronkelijk.width, hoogte: oorspronkelijk.height } },
  }
}

/**
 * Zoekt het logo bij een Asana-taak.
 *
 * Geeft altijd een uitkomst terug, nooit een uitzondering: `logo` is de data-URI
 * of null, en `reden` zegt in gewoon Nederlands wat er aan de hand is. De
 * aanroeper beslist of dat wachten of mislukken betekent.
 */
export async function logoVoorTaak(taakGid) {
  const subtaken = await getSubtasks(taakGid)
  const subtaak = subtaken.find((s) => isMenuSubtaak(s.name))
  if (!subtaak) {
    return { logo: null, wacht: false,
             reden: 'Er is geen subtaak om het logo aan te hangen. Verwacht wordt een subtaak '
               + `die begint met ${MENU_SUBTAAK_NAMEN.map((n) => `"${n}"`).join(' of ')}.` }
  }

  const bijlagen = await getAttachments(subtaak.gid)
  const { logo, onbruikbaar, meerdere } = kiesLogo(bijlagen)
  if (!logo) {
    if (!onbruikbaar.length) {
      return { logo: null, wacht: true, subtaak,
               reden: `Er hangt nog geen logo aan de subtaak "${subtaak.name}".` }
    }
    const namen = onbruikbaar.map((b) => `"${b.name}"`).join(', ')
    return { logo: null, wacht: false, subtaak,
             reden: `Aan "${subtaak.name}" hangt ${namen}, en daar kunnen wij geen logo `
               + 'uit halen. Stuur een PNG, JPG of SVG.' }
  }

  const bestand = await downloadAttachment(logo.gid)
  const beeld = await logoBeeld(bestand)
  const notities = []
  if (meerdere) notities.push(`Er hingen meer afbeeldingen aan "${subtaak.name}"; `
    + `"${logo.name}" is gebruikt.`)
  return { logo: beeld.uri, beeld, wacht: false, subtaak, bestandsnaam: logo.name, notities }
}
