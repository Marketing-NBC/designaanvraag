import jpeg from 'jpeg-js'
import { encode as pngEncode } from 'fast-png'
import { describe, expect, it } from 'vitest'
import {
  SCHERM_FOTOS, beeldKop, fotoNaarScherm, heeftTorenschermPreview, isTorenschermBeeld, kiesTorenschermOntwerpen, omgekeerd,
  vierkantNaarHoeken, verklein, zetOpScherm, type Hoeken, type Pixels,
} from './torenscherm-preview'
import { decodeerBeeld, maakTorenschermPreview } from './torenscherm-render'
import { renderOpleveringMail, verslagProef, verslagVerstuurd, type OpleveringMail } from './oplevering'

// Via een berekende naam: de build van web/ kent de types van Node niet, en vitest draait in Node.
const fs: { readFileSync(pad: URL): Uint8Array } = await import(/* @vite-ignore */ ['node', 'fs'].join(':'))

/** Een vlak van één kleur. */
function vlak(breedte: number, hoogte: number, [r, g, b, a = 255]: number[]): Pixels {
  const data = new Uint8Array(breedte * hoogte * 4)
  for (let i = 0; i < data.length; i += 4) data.set([r, g, b, a], i)
  return { breedte, hoogte, data }
}

const pixel = (p: Pixels, x: number, y: number) => Array.from(p.data.subarray((y * p.breedte + x) * 4, (y * p.breedte + x) * 4 + 4))

describe('welke aanvragen en bijlagen een torenscherm-preview krijgen', () => {
  it('alleen bij een torenscherm, en alleen waar een foto van is', () => {
    expect(heeftTorenschermPreview(['torenscherm'], 'nbc')).toBe(true)
    expect(heeftTorenschermPreview(['led_kolom', 'torenscherm'], 'nbc')).toBe(true)
    expect(heeftTorenschermPreview(['koffiescherm'], 'nbc')).toBe(false)
    expect(heeftTorenschermPreview(['torenscherm'], 'green_village')).toBe(false)
    expect(heeftTorenschermPreview(null, 'nbc')).toBe(false)
  })

  it('leest de maat uit een PNG en een JPEG zonder ze uit te pakken', () => {
    const png = pngEncode({ width: 21, height: 12, data: new Uint8Array(21 * 12 * 4), channels: 4 })
    expect(beeldKop(png)).toEqual({ soort: 'png', breedte: 21, hoogte: 12 })
    const jpg = jpeg.encode({ width: 33, height: 18, data: new Uint8Array(33 * 18 * 4) }, 80).data
    expect(beeldKop(new Uint8Array(jpg))).toEqual({ soort: 'jpeg', breedte: 33, hoogte: 18 })
    expect(beeldKop(new TextEncoder().encode('%PDF-1.7 en nog wat'))).toBeNull()
  })

  it('herkent een torenscherm aan de verhouding; een 16:9-scherm niet, behalve met "toren" in de naam', () => {
    expect(isTorenschermBeeld('scherm.jpg', 2112, 1152)).toBe(true)
    expect(isTorenschermBeeld('scherm.jpg', 1056, 576)).toBe(true)
    expect(isTorenschermBeeld('koffiescherm.jpg', 1920, 1080)).toBe(false)
    expect(isTorenschermBeeld('Torenscherm EY.jpg', 1920, 1080)).toBe(true)
    expect(isTorenschermBeeld('Torenscherm EY.jpg', 1080, 1920)).toBe(false)
    expect(isTorenschermBeeld('buitenscherm.jpg', 1588, 432)).toBe(false)
  })

  it('kiest de torenscherm-designs uit de bijlagen, in volgorde en hooguit drie', () => {
    const png = (w: number, h: number) => pngEncode({ width: w, height: h, data: new Uint8Array(w * h * 4), channels: 4 })
    const bijlagen = [
      { naam: 'drukwerk.pdf', bytes: new TextEncoder().encode('%PDF') },
      { naam: 'a.png', bytes: png(2112, 1152) },
      { naam: 'koffie.png', bytes: png(192, 108) },
      { naam: 'b.png', bytes: png(211, 115) },
      { naam: 'c.png', bytes: png(2112, 1152) },
      { naam: 'd.png', bytes: png(2112, 1152) },
    ]
    expect(kiesTorenschermOntwerpen(bijlagen).map((b) => b.naam)).toEqual(['a.png', 'b.png', 'c.png'])
  })
})

describe('het design in perspectief op het scherm', () => {
  const hoeken: Hoeken = { lb: [10, 10], rb: [50, 20], ro: [50, 40], lo: [10, 50] }

  it('de hoeken van het scherm komen op de hoeken van het design', () => {
    const inv = omgekeerd(vierkantNaarHoeken(hoeken))
    for (const [p, uv] of [[hoeken.lb, [0, 0]], [hoeken.rb, [1, 0]], [hoeken.ro, [1, 1]], [hoeken.lo, [0, 1]]] as const) {
      const [u, v] = fotoNaarScherm(inv, p[0], p[1])
      expect(u).toBeCloseTo(uv[0], 9)
      expect(v).toBeCloseTo(uv[1], 9)
    }
  })

  it('binnen het scherm het design, erbuiten de foto, en de foto zelf blijft heel', () => {
    const foto = vlak(60, 60, [100, 100, 100])
    const voor = Array.from(foto.data)
    const uit = zetOpScherm(foto, vlak(211, 115, [200, 30, 40]), hoeken)
    expect(pixel(uit, 30, 30)).toEqual([200, 30, 40, 255])
    expect(pixel(uit, 5, 5)).toEqual([100, 100, 100, 255])
    expect(pixel(uit, 55, 30)).toEqual([100, 100, 100, 255])
    expect(Array.from(foto.data)).toEqual(voor)
  })

  it('links in het design blijft links, boven blijft boven', () => {
    const ontwerp = vlak(200, 100, [0, 0, 255])
    for (let y = 0; y < 50; y++) for (let x = 0; x < 100; x++) ontwerp.data.set([255, 0, 0, 255], (y * 200 + x) * 4)
    const uit = zetOpScherm(vlak(60, 60, [0, 0, 0]), ontwerp, hoeken)
    expect(pixel(uit, 18, 18)).toEqual([255, 0, 0, 255])
    expect(pixel(uit, 45, 35)).toEqual([0, 0, 255, 255])
  })

  it('een doorzichtig stuk wordt zwart, zoals een scherm dat uit staat', () => {
    const uit = zetOpScherm(vlak(60, 60, [100, 100, 100]), vlak(40, 22, [255, 255, 255, 0]), hoeken)
    expect(pixel(uit, 30, 30)).toEqual([0, 0, 0, 255])
  })

  it('verkleinen middelt de blokjes', () => {
    const p = vlak(4, 2, [0, 0, 0])
    p.data.set([200, 100, 0, 255], 0)
    expect(verklein(p, 2)).toEqual({ breedte: 2, hoogte: 1, data: new Uint8Array([50, 25, 0, 255, 0, 0, 0, 255]) })
    expect(verklein(p, 1)).toBe(p)
  })
})

describe('de echte foto', () => {
  const info = SCHERM_FOTOS.nbc!
  const foto = decodeerBeeld(fs.readFileSync(new URL(`../web/public/torenscherm/${info.bestand}`, import.meta.url)))

  it('heeft de maat waarop de hoeken zijn opgemeten', () => {
    expect([foto.breedte, foto.hoogte]).toEqual([info.breedte, info.hoogte])
  })

  it('een JPEG- en een PNG-design worden een JPEG met het design op het scherm', () => {
    const kleur = [220, 40, 120]
    const ontwerp = vlak(2112, 1152, kleur)
    const midden = [Math.round((info.hoeken.lb[0] + info.hoeken.ro[0]) / 2), Math.round((info.hoeken.lb[1] + info.hoeken.ro[1]) / 2)]
    for (const bytes of [
      new Uint8Array(jpeg.encode({ width: 2112, height: 1152, data: ontwerp.data }, 95).data),
      pngEncode({ width: 2112, height: 1152, data: ontwerp.data, channels: 4 }),
    ]) {
      const uit = decodeerBeeld(maakTorenschermPreview(bytes, foto, info))
      expect([uit.breedte, uit.hoogte]).toEqual([info.breedte, info.hoogte])
      const [r, g, b] = pixel(uit, midden[0], midden[1])
      expect(Math.abs(r - kleur[0]) + Math.abs(g - kleur[1]) + Math.abs(b - kleur[2])).toBeLessThan(20)
      // Buiten het scherm de foto, op wat JPEG-ruis na.
      const buiten = pixel(uit, 5, 5), origineel = pixel(foto, 5, 5)
      expect(buiten.every((v, i) => Math.abs(v - origineel[i]) < 8)).toBe(true)
    }
  })

  it('een PNG met een palet of in grijs gaat ook', () => {
    const grijs = pngEncode({ width: 211, height: 115, data: new Uint8Array(211 * 115).fill(128), channels: 1 })
    expect(pixel(decodeerBeeld(grijs), 0, 0)).toEqual([128, 128, 128, 255])
    const palet = pngEncode({ width: 2, height: 1, data: new Uint8Array([0, 1]), channels: 1, depth: 8, palette: [[255, 0, 0], [0, 0, 255]] })
    expect(pixel(decodeerBeeld(palet), 1, 0)).toEqual([0, 0, 255, 255])
  })

  it('wat geen JPEG of PNG is, geeft een leesbare fout', () => {
    expect(() => decodeerBeeld(new TextEncoder().encode('%PDF-1.7'))).toThrow('Geen JPEG of PNG')
  })
})

describe('in de opleveringsmail', () => {
  const basis: OpleveringMail = {
    aan: ['britt@nbcevents.nl'], antwoordAan: ['marketing@nbcevents.nl'], aanvraagId: 'a1', versie: 1, locatie: 'nbc', soort: 'evenement',
    event: 'Zorgcongres', eventDatum: '2026-12-11', omschrijving: '', types: ['torenscherm'], andersTekst: '', berichtHtml: 'Hierbij.',
    afzenderNaam: null, aanvrager: 'Britt', akkoord: true, bijlagen: [], links: [],
  }

  it('staat de preview bovenaan in plaats van het gifje, over de volle breedte en zonder tekst eronder', () => {
    const html = renderOpleveringMail({ ...basis, torenscherm: [{ cid: 'torenscherm-1', breedte: 1120, hoogte: 747, alt: 'Op het scherm' }] }).html
    // 600 px, net als de kop; de klassieke Outlook rekent met width en height.
    expect(html).toContain('<tr><td style="padding:0;font-size:0;line-height:0;"><img src="cid:torenscherm-1" width="600" height="400" alt="Op het scherm"')
    expect(html).toContain('width:600px;max-width:100%;height:auto;')
    expect(html).not.toContain('1120')
    expect(html).not.toContain('Zo komt je design')
    expect(html).not.toContain('<!--mailgif:')
    expect(html.indexOf('cid:torenscherm-1')).toBeLessThan(html.indexOf('Hierbij.'))
  })

  it('zonder preview gewoon het gifje', () => {
    expect(renderOpleveringMail(basis).html).toContain('<!--mailgif:oplevering-->')
    expect(renderOpleveringMail({ ...basis, torenscherm: [] }).html).toContain('<!--mailgif:oplevering-->')
  })

  it('het verslag zegt of de preview erin staat, en zo niet waarom', () => {
    const v = { naar: 'devi@nbcevents.nl', aan: ['britt@nbcevents.nl'], bijlagen: ['toren.jpg'], links: [] }
    expect(verslagProef({ ...v, torenscherm: { aantal: 1, noot: null } })).toContain('Bovenaan de mail staat het design op de foto van het torenscherm.')
    expect(verslagProef({ ...v, torenscherm: { aantal: 2, noot: null } })).toContain('staan de 2 designs')
    expect(verslagProef({ ...v, torenscherm: { aantal: 0, noot: 'Geen <goede> maat.' } })).toContain('Geen &lt;goede&gt; maat.')
    expect(verslagProef(v)).not.toContain('torenscherm.')
    expect(verslagVerstuurd({ versie: 1, aan: ['b@x.nl'], bijlagen: [], links: [], datum: '2026-11-06', torenscherm: { aantal: 1, noot: null } }))
      .toContain('Bovenaan de mail staat het design')
  })
})
