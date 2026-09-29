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

// Ruim boven wat een logo nodig heeft (de balk is 791 breed op een 4K-scherm),
// maar klein genoeg om niet met een foto van 8 MB de pagina in te gaan.
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
  const soort = BEELDSOORTEN[extensie(bijlage.name)]
  if (!soort) throw new Error(`"${bijlage.name}" is geen afbeelding die wij kunnen zetten.`)
  let buffer = bijlage.buffer
  if (soort !== 'image/svg+xml') {
    const info = await sharp(buffer).metadata()
    if (info.width > MAX_BREEDTE) {
      buffer = await sharp(buffer).resize({ width: MAX_BREEDTE }).png().toBuffer()
      return `data:image/png;base64,${buffer.toString('base64')}`
    }
  }
  return `data:${soort};base64,${buffer.toString('base64')}`
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
  const uri = await logoDataUri(bestand)
  const notities = []
  if (meerdere) notities.push(`Er hingen meer afbeeldingen aan "${subtaak.name}"; `
    + `"${logo.name}" is gebruikt.`)
  return { logo: uri, wacht: false, subtaak, bestandsnaam: logo.name, notities }
}
