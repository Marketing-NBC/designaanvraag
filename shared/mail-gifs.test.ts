import { describe, expect, it } from 'vitest'
// @ts-expect-error: een .mjs-script zonder typen
import { leesGifs } from '../scripts/mail-gifs.mjs'
import { gifPlek, gifRegel, heeftGifPlek, mailOpmaak, vulGifIn } from './mail'
import { GIF_MAPPEN, MAIL_GIF_BASIS, altVan, gifLijstVan, kiesGif, maatInMail } from './mail-gifs'
import type { GifLijst } from './mail-gifs'
import { renderBevestigingMail } from './bevestiging'
import { aanvraagSchema } from './aanvraag-schema'

const lijst: GifLijst = {
  bevestiging: [{ bestand: 'bevestiging/im-on-it.gif', breedte: 480, hoogte: 287 }],
  akkoord: [
    { bestand: 'akkoord/Yes baby.gif', breedte: 640, hoogte: 360 },
    { bestand: 'akkoord/kermit.gif', breedte: 200, hoogte: 600 },
  ],
}

describe('de mappen in de repo', () => {
  const { lijst: echt, overgeslagen } = leesGifs() as { lijst: GifLijst; overgeslagen: string[] }

  it('bevatten alleen gifjes, in mappen van een mail', () => {
    expect(overgeslagen).toEqual([])
  })

  it('hebben gifjes voor de bevestiging, de oplevering en de herinnering', () => {
    for (const map of ['bevestiging', 'oplevering', 'herinnering'] as const) expect(echt[map]?.length).toBeGreaterThan(0)
  })

  it('geven een maat per gifje', () => {
    for (const g of Object.values(echt).flat()) {
      expect(g.breedte).toBeGreaterThan(0)
      expect(g.hoogte).toBeGreaterThan(0)
      expect(GIF_MAPPEN).toContain(g.bestand.split('/')[0])
    }
  })
})

describe('kiesGif', () => {
  it('geeft null bij een lege map of zonder lijst', () => {
    expect(kiesGif(lijst, 'aanvulling')).toBeNull()
    expect(kiesGif(null, 'bevestiging')).toBeNull()
  })

  it('maakt een adres op Pages, met spaties gecodeerd', () => {
    expect(kiesGif(lijst, 'bevestiging')!.url).toBe(`${MAIL_GIF_BASIS}bevestiging/im-on-it.gif`)
    expect(kiesGif(lijst, 'akkoord', MAIL_GIF_BASIS, () => 0)!.url).toBe(`${MAIL_GIF_BASIS}akkoord/Yes%20baby.gif`)
  })

  it('kiest uit de hele map en valt er bij bijna 1 niet buiten', () => {
    expect(kiesGif(lijst, 'akkoord', MAIL_GIF_BASIS, () => 0.6)!.url).toContain('kermit.gif')
    expect(kiesGif(lijst, 'akkoord', MAIL_GIF_BASIS, () => 0.99999)).not.toBeNull()
  })

  it('maakt de alt-tekst uit de bestandsnaam', () => {
    expect(altVan('akkoord/Yes-baby_2.gif')).toBe('Yes baby 2')
  })
})

describe('maatInMail', () => {
  it('past binnen 480 × 360 met dezelfde verhouding, en vergroot niet', () => {
    expect(maatInMail(640, 360)).toEqual({ breedte: 480, hoogte: 270 })
    expect(maatInMail(200, 600)).toEqual({ breedte: 120, hoogte: 360 })
    expect(maatInMail(300, 200)).toEqual({ breedte: 300, hoogte: 200 })
  })
})

describe('het gifje in de mail', () => {
  it('mailOpmaak zet alleen de plek, tussen kop en inhoud', () => {
    const html = mailOpmaak('Kop', '<p>Inhoud</p>', undefined, undefined, 'akkoord')
    expect(heeftGifPlek(html)).toBe(true)
    expect(html).not.toContain('<img')
    expect(html.indexOf(gifPlek('akkoord'))).toBeGreaterThan(html.indexOf('>Kop<'))
    expect(html.indexOf('Inhoud')).toBeGreaterThan(html.indexOf(gifPlek('akkoord')))
  })

  it('vulGifIn zet er een gifje uit de map neer', () => {
    const html = vulGifIn(mailOpmaak('Kop', 'x', undefined, undefined, 'bevestiging'), lijst)
    expect(html).toContain(`<img src="${MAIL_GIF_BASIS}bevestiging/im-on-it.gif" width="480" height="287" alt="im on it"`)
    expect(heeftGifPlek(html)).toBe(false)
  })

  it('zonder gifje in de map, of zonder lijst, blijft er niets van over', () => {
    for (const html of [vulGifIn(mailOpmaak('K', 'x', undefined, undefined, 'aanvulling'), lijst), vulGifIn(mailOpmaak('K', 'x', undefined, undefined, 'akkoord'), null)]) {
      expect(html).not.toContain('<img')
      expect(heeftGifPlek(html)).toBe(false)
    }
  })

  it('gifRegel houdt het gifje binnen de mail', () => {
    const regel = gifRegel({ url: 'https://x/a.gif', breedte: 640, hoogte: 360, alt: 'Een "test"' })
    expect(regel).toContain('width="480" height="270"')
    expect(regel).toContain('alt="Een &quot;test&quot;"')
  })

  it('zonder map is de mail zoals vroeger', () => {
    expect(heeftGifPlek(mailOpmaak('Kop', 'x'))).toBe(false)
  })

  it('de bevestiging vraagt om een gifje uit de map bevestiging', () => {
    const aanvraag = aanvraagSchema.parse({
      naam: 'Britt', event: 'EY', event_datum: '2026-12-11', deadline: '2026-12-09', aanvraag_types: ['torenscherm'], design_modus: 'custom', omschrijving: 'x',
    })
    const m = renderBevestigingMail({ aanvraag, aanvraagId: 'id', aan: 'a@b.nl', antwoordAan: 'c@d.nl' })
    expect(m.html).toContain(gifPlek('bevestiging'))
  })
})

describe('gifLijstVan', () => {
  it('haalt de lijst één keer en onthoudt hem', async () => {
    let n = 0
    const f = (async () => { n++; return Response.json(lijst) }) as unknown as typeof fetch
    const haal = gifLijstVan(MAIL_GIF_BASIS, f)
    expect(await haal()).toEqual(lijst)
    expect(await haal()).toEqual(lijst)
    expect(n).toBe(1)
  })

  it('geeft null bij een fout, zonder te gooien', async () => {
    expect(await gifLijstVan(MAIL_GIF_BASIS, (async () => new Response('', { status: 404 })) as unknown as typeof fetch)()).toBeNull()
    expect(await gifLijstVan(MAIL_GIF_BASIS, (async () => { throw new Error('offline') }) as unknown as typeof fetch)()).toBeNull()
  })
})
