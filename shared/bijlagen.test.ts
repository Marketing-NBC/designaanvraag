import { describe, expect, it } from 'vitest'
// Als tekst ingelezen door Vite, niet via node:fs: het web-project kent geen node-types.
import migratieSql from '../supabase/migrations/20260916090000_bijlagen.sql?raw'
import {
  ACCEPT_ATTRIBUUT,
  MAX_BIJLAGEN,
  MAX_BIJLAGE_BYTES,
  TOEGESTANE_BESTANDEN,
  bestandProbleem,
  bestandToegestaan,
  bestandsnaamOpschonen,
  formatBytes,
  magischeBytesKloppen,
  uploadlinkPayloadSchema,
} from './bijlagen'

const bytes = (...n: number[]) => new Uint8Array(n)
const tekst = (s: string) => new TextEncoder().encode(s)

describe('welke bestanden mogen mee', () => {
  it('laat de gewone soorten door', () => {
    expect(bestandToegestaan('logo.png', 'image/png')).toBe(true)
    expect(bestandToegestaan('Foto.JPG', 'image/jpeg')).toBe(true)
    expect(bestandToegestaan('voorbeeld.pdf', 'application/pdf')).toBe(true)
    expect(bestandToegestaan('brief.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true)
  })

  it('weigert design-bronbestanden', () => {
    for (const [naam, mime] of [
      ['logo.ai', 'application/postscript'],
      ['ontwerp.psd', 'image/vnd.adobe.photoshop'],
      ['boekje.indd', 'application/x-indesign'],
    ]) {
      expect(bestandToegestaan(naam, mime)).toBe(false)
    }
  })

  it('weigert een type dat niet bij de extensie hoort', () => {
    // Een uitvoerbaar bestand dat zich voordoet als afbeelding.
    expect(bestandToegestaan('virus.exe', 'image/png')).toBe(false)
    expect(bestandToegestaan('logo.png', 'application/x-msdownload')).toBe(false)
  })

  it('zegt bij een iPhone-foto wat je er wél mee kunt', () => {
    const probleem = bestandProbleem('IMG_0421.HEIC', 'image/heic', 2_000_000)
    expect(probleem).toContain('JPG')
  })

  it('noemt bij een te groot bestand de grens en het alternatief', () => {
    expect(bestandProbleem('groot.pdf', 'application/pdf', MAX_BIJLAGE_BYTES)).toBeNull()
    const probleem = bestandProbleem('groter.pdf', 'application/pdf', MAX_BIJLAGE_BYTES + 1)
    expect(probleem).toContain('25,0 MB')
    expect(probleem).toContain('schijf')
  })

  it('weigert een leeg bestand', () => {
    expect(bestandProbleem('leeg.pdf', 'application/pdf', 0)).toContain('leeg')
  })

  it('biedt de bestandskiezer zowel types als extensies aan', () => {
    expect(ACCEPT_ATTRIBUUT).toContain('image/png')
    expect(ACCEPT_ATTRIBUUT).toContain('.pptx')
  })
})

describe('bestandsnamen opschonen', () => {
  it('haalt paden en stuurtekens eruit', () => {
    expect(bestandsnaamOpschonen('../../etc/passwd')).toBe('..-..-etc-passwd')
    expect(bestandsnaamOpschonen('C:\\Users\\Abel\\logo.png')).toBe('C:-Users-Abel-logo.png')
    expect(bestandsnaamOpschonen('lo\u0000go.png')).toBe('logo.png')
  })

  it('houdt de extensie bij het inkorten', () => {
    const lang = bestandsnaamOpschonen(`${'a'.repeat(300)}.pdf`)
    expect(lang.length).toBe(120)
    expect(lang.endsWith('.pdf')).toBe(true)
  })

  it('valt terug op iets bruikbaars bij een onzinnige naam', () => {
    expect(bestandsnaamOpschonen('..')).toBe('bestand')
    expect(bestandsnaamOpschonen('   ')).toBe('bestand')
  })

  it('laat een gewone naam met spaties en accenten met rust', () => {
    expect(bestandsnaamOpschonen('Huisstijl café 2026.pdf')).toBe('Huisstijl café 2026.pdf')
  })
})

describe('magische bytes', () => {
  it('herkent elk toegestaan type aan zijn eerste bytes', () => {
    expect(magischeBytesKloppen('image/png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(true)
    expect(magischeBytesKloppen('image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true)
    expect(magischeBytesKloppen('application/pdf', tekst('%PDF-1.4\n'))).toBe(true)
    expect(magischeBytesKloppen('application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes(0x50, 0x4b, 0x03, 0x04))).toBe(true)
    expect(magischeBytesKloppen('application/msword', bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1))).toBe(true)
    expect(magischeBytesKloppen('image/svg+xml', tekst('<svg xmlns="http://www.w3.org/2000/svg">'))).toBe(true)
    expect(magischeBytesKloppen('image/svg+xml', tekst('\ufeff  <?xml version="1.0"?><svg/>'))).toBe(true)
  })

  it('ontmaskert een bestand dat over zijn type liegt', () => {
    // Een PNG die zegt een PDF te zijn: precies waar de bucket blind voor is.
    expect(magischeBytesKloppen('application/pdf', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(false)
    expect(magischeBytesKloppen('image/png', tekst('%PDF-1.4'))).toBe(false)
    expect(magischeBytesKloppen('image/svg+xml', bytes(0x4d, 0x5a))).toBe(false) // een .exe
  })

  it('valt niet om op te weinig bytes', () => {
    expect(magischeBytesKloppen('image/png', bytes(0x89))).toBe(false)
    expect(magischeBytesKloppen('application/pdf', new Uint8Array())).toBe(false)
  })

  it('kent geen enkel type buiten de lijst', () => {
    expect(magischeBytesKloppen('application/zip', bytes(0x50, 0x4b, 0x03, 0x04))).toBe(false)
  })
})

describe('uploadlinkPayloadSchema', () => {
  const geldig = {
    doel: 'aanvraag' as const,
    groep_id: crypto.randomUUID(),
    bestanden: [{ naam: 'logo.png', type: 'image/png', grootte: 12_345 }],
  }

  it('accepteert een gewone batch', () => {
    expect(uploadlinkPayloadSchema.safeParse(geldig).success).toBe(true)
  })

  it('weigert meer dan het maximum aantal bestanden', () => {
    const teveel = { ...geldig, bestanden: Array.from({ length: MAX_BIJLAGEN + 1 }, () => geldig.bestanden[0]) }
    expect(uploadlinkPayloadSchema.safeParse(teveel).success).toBe(false)
  })

  it('weigert een batch die samen over het totaal gaat', () => {
    const zwaar = {
      ...geldig,
      bestanden: Array.from({ length: 3 }, (_, i) => ({ naam: `groot${i}.pdf`, type: 'application/pdf', grootte: 20 * 1024 * 1024 })),
    }
    const r = uploadlinkPayloadSchema.safeParse(zwaar)
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.message).toContain('Samen maximaal')
  })

  it('wijst het bestand aan dat niet deugt', () => {
    const gemengd = { ...geldig, bestanden: [geldig.bestanden[0], { naam: 'ontwerp.psd', type: 'image/vnd.adobe.photoshop', grootte: 100 }] }
    const r = uploadlinkPayloadSchema.safeParse(gemengd)
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.path).toEqual(['bestanden', 1])
  })

  it('eist een echte groep-uuid en een bekend doel', () => {
    expect(uploadlinkPayloadSchema.safeParse({ ...geldig, groep_id: 'abc' }).success).toBe(false)
    expect(uploadlinkPayloadSchema.safeParse({ ...geldig, doel: 'iets-anders' }).success).toBe(false)
  })
})

describe('de bucket en de code lopen niet uit elkaar', () => {
  it('kent de migratie precies dezelfde types als TOEGESTANE_BESTANDEN', () => {
    // Alleen het allowed_mime_types-blok, niet de toelichting eromheen.
    const blok = migratieSql.slice(migratieSql.indexOf('allowed_mime_types'), migratieSql.indexOf('on conflict'))
    for (const soort of TOEGESTANE_BESTANDEN) {
      expect(blok, `${soort.mime} ontbreekt in de migratie`).toContain(`'${soort.mime}'`)
    }
    const inMigratie = blok.match(/'[a-z]+\/[^']+'/g) ?? []
    expect(inMigratie.length, 'de migratie staat meer types toe dan de code kent').toBe(TOEGESTANE_BESTANDEN.length)
  })

  it('zet dezelfde bestandsgrens op de bucket', () => {
    expect(migratieSql).toContain(String(MAX_BIJLAGE_BYTES))
  })
})

describe('formatBytes', () => {
  it('leest als Nederlands', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 kB')
    expect(formatBytes(25 * 1024 * 1024)).toBe('25,0 MB')
  })
})
