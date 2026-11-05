import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { gifRegel, mailOpmaak } from './mail'
import { MAIL_GIFS, MAIL_GIF_BASIS, MAX_GIF_BREEDTE, gifVoor, kiesGif } from './mail-gifs'
import type { GifMail } from './mail-gifs'

const MAP = join(__dirname, '..', 'web', 'public', 'mail-gifs')
const alle = Object.entries(MAIL_GIFS).flatMap(([mail, rij]) => rij.map((g) => ({ mail, ...g })))

describe('de gifjes zelf', () => {
  it.each(alle)('$mail: $bestand staat in web/public/mail-gifs met de opgegeven maat', (g) => {
    const pad = join(MAP, g.bestand)
    expect(existsSync(pad)).toBe(true)
    const kop = readFileSync(pad)
    // Een GIF begint met GIF87a of GIF89a, met daarna breedte en hoogte (little-endian).
    expect(kop.subarray(0, 3).toString('latin1')).toBe('GIF')
    expect(kop.readUInt16LE(6)).toBe(g.breedte)
    expect(kop.readUInt16LE(8)).toBe(g.hoogte)
  })

  it.each(alle)('$mail: $bestand is klein genoeg voor een telefoon (onder 600 KB)', (g) => {
    expect(statSync(join(MAP, g.bestand)).size).toBeLessThan(600_000)
  })

  it.each(alle)('$mail: $bestand heeft een alt-tekst', (g) => {
    expect(g.alt.trim()).not.toBe('')
  })
})

describe('kiesGif', () => {
  it('geeft null als er voor die mail (nog) geen gifjes zijn', () => {
    const leeg = (Object.keys(MAIL_GIFS) as GifMail[]).find((m) => !MAIL_GIFS[m].length)
    if (leeg) expect(kiesGif(leeg)).toBeNull()
  })

  it('maakt een adres op GitHub Pages, of op de opgegeven basis', () => {
    const g = kiesGif('bevestiging', MAIL_GIF_BASIS, () => 0)!
    expect(g.url).toBe(`${MAIL_GIF_BASIS}${MAIL_GIFS.bevestiging[0].bestand}`)
    const branch = kiesGif('bevestiging', 'https://raw.githubusercontent.com/o/r/abc/web/public/mail-gifs/', () => 0.999)!
    expect(branch.url.startsWith('https://raw.githubusercontent.com/o/r/abc/web/public/mail-gifs/')).toBe(true)
  })

  it('valt bij een kans van bijna 1 niet buiten het rijtje', () => {
    expect(kiesGif('bevestiging', MAIL_GIF_BASIS, () => 0.99999)).not.toBeNull()
  })

  it('gifVoor: weglaten is kiezen, null is geen gifje', () => {
    expect(gifVoor('bevestiging', null)).toBeNull()
    const eigen = { url: 'https://x/y.gif', breedte: 10, hoogte: 10, alt: 'y' }
    expect(gifVoor('bevestiging', eigen)).toBe(eigen)
    expect(gifVoor('bevestiging', undefined)?.url).toContain('mail-gifs/')
  })
})

describe('het gifje in de mail', () => {
  const gif = { url: 'https://voorbeeld.nl/mail-gifs/a.gif', breedte: 640, hoogte: 360, alt: 'Een "test"' }

  it('staat tussen de kop en de inhoud', () => {
    const html = mailOpmaak('Kop', '<p>Inhoud</p>', undefined, undefined, gif)
    const kop = html.indexOf('>Kop<')
    const img = html.indexOf('<img')
    expect(kop).toBeGreaterThan(-1)
    expect(img).toBeGreaterThan(kop)
    expect(html.indexOf('Inhoud')).toBeGreaterThan(img)
  })

  it('wordt niet breder dan de mail en houdt zijn verhouding', () => {
    const regel = gifRegel(gif)
    expect(regel).toContain(`width="${MAX_GIF_BREEDTE}"`)
    expect(regel).toContain(`height="${Math.round((360 * MAX_GIF_BREEDTE) / 640)}"`)
    expect(regel).toContain('alt="Een &quot;test&quot;"')
  })

  it('zonder gifje is de mail zoals vroeger', () => {
    expect(mailOpmaak('Kop', 'x')).not.toContain('<img')
  })
})
