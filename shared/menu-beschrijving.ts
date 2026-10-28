/**
 * Het menu in de beschrijving van de Asana-taak.
 *
 * Bij het indienen komt de menu-invulling onder het kopje "Menu" in de taakbeschrijving te staan
 * (zie supabase/functions/_shared/notes.ts). Die beschrijving is de plek waar Marketing het menu
 * nog corrigeert, en daarom is hij ook de basis van het menuscherm: wat daar staat, wordt
 * gegenereerd. Dit bestand leest het menu daar uit, en zet er een nieuw menu in als de aanvrager
 * het via "Menu aanpassen" verandert.
 *
 * Dependency-vrij: de edge functions gebruiken het, en de worker laadt het met Node.
 */

/** Zo begint het menu in de beschrijving. Asana bewaart een kopje als <h2>. */
const MENU_KOP = /<h2>\s*Menu\s*<\/h2>/i
/** Hier houdt het menu op: het volgende kopje of de streep voor de huisstijl. */
const EINDE = /<h[12]>|<hr\s*\/?>/i

function ontEntiteit(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Het menu uit de beschrijving, als platte tekst zoals de opmaak-engine hem leest: een kopje per
 * gang, de gerechten met een bolletje. Null als er geen kopje "Menu" in staat.
 *
 * Wie in Asana een lijstje maakt van de gerechten, krijgt <li>'s in plaats van bolletjes; die
 * worden weer bolletjes. Witregels en spaties aan het eind doen er niet toe.
 */
export function menuUitBeschrijving(html: string | null | undefined): string | null {
  const bron = html ?? ''
  const kop = MENU_KOP.exec(bron)
  if (!kop) return null
  const na = bron.slice(kop.index + kop[0].length)
  const einde = EINDE.exec(na)
  const stuk = einde ? na.slice(0, einde.index) : na.replace(/<\/body>\s*$/i, '')
  const tekst = ontEntiteit(
    stuk
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<br\s*\/?>|<\/(p|li|blockquote|ul|ol|div)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
  const regels = tekst.split(/\r?\n/).map((r) => r.replace(/\s+$/, '')).filter((r) => r.trim())
  return regels.length ? regels.join('\n') : null
}

/** Vergelijkbaar maken: zelfde regels, zelfde tekst, ongeacht witruimte en soort bolletje. */
export function menuSleutel(tekst: string | null | undefined): string {
  return String(tekst ?? '')
    .split(/\r?\n/)
    .map((r) => r.trim().replace(/^[•·\-–—*]\s*/, '• ').replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('\n')
}

/**
 * De beschrijving met dit menu onder het kopje "Menu". Staat er al een menu, dan wordt dat
 * vervangen; staat er nog geen, dan komt het voor de streep van de huisstijl (of anders achteraan).
 */
export function vervangMenuInBeschrijving(html: string, menuTekst: string): string {
  const blok = `<h2>Menu</h2>\n<blockquote>${escapeXml(menuTekst)}</blockquote>\n`
  const bron = html || '<body></body>'
  const kop = MENU_KOP.exec(bron)
  if (kop) {
    const na = bron.slice(kop.index + kop[0].length)
    const einde = EINDE.exec(na)
    const rest = einde ? na.slice(einde.index) : (/<\/body>\s*$/i.exec(na)?.[0] ?? '')
    return bron.slice(0, kop.index) + blok + rest
  }
  const streep = /<hr\s*\/?>/i.exec(bron)
  if (streep) return bron.slice(0, streep.index) + blok + bron.slice(streep.index)
  return bron.replace(/<\/body>\s*$/i, `${blok}</body>`)
}
