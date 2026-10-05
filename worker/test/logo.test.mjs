/**
 * Het logo van de opdrachtgever.
 *
 * Marketing hangt het aan de subtaak van het menuscherm; de worker haalt het daar
 * op en zet het in de balk rechtsboven. Wat hier getoetst wordt is de keuze: welke
 * bijlage is het logo, en wat doen we met wat er verder hangt.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { WORKER_DIR } from '../lib/config.mjs'
import { bruikbaarAlsLogo, kiesLogo, logoDataUri } from '../menu/logo.mjs'
import { handmatigeKleuren, merkKleuren } from '../menu/kleuren.mjs'
import { veldTekst } from '../menu/knop.mjs'
import { isMenuSubtaak, MENU_SUBTAAK_NAMEN, subtaskTitles } from '../../shared/asana-title.ts'

const NBC_LOGO = join(WORKER_DIR, '..', 'web', 'src', 'assets', 'brand', 'nbc-logo-color-black.png')

test('een drukwerkbestand is geen logo dat wij kunnen zetten', () => {
  for (const naam of ['logo.png', 'LOGO.PNG', 'merk.jpg', 'merk.jpeg', 'huisstijl.svg', 'logo.webp']) {
    assert.equal(bruikbaarAlsLogo({ name: naam }), true, naam)
  }
  // Een PDF, EPS of .ai kan de browser niet als afbeelding zetten. Die moeten we
  // weigeren met een duidelijke melding, niet stilletjes overslaan.
  for (const naam of ['logo.pdf', 'logo.eps', 'logo.ai', 'briefing.docx', 'logo']) {
    assert.equal(bruikbaarAlsLogo({ name: naam }), false, naam)
  }
})

test('van meerdere bijlagen wint die met "logo" in de naam', () => {
  const { logo } = kiesLogo([
    { gid: '1', name: 'plattegrond.png', created_at: '2026-09-01T10:00:00Z' },
    { gid: '2', name: 'Deloitte-logo.png', created_at: '2026-09-01T09:00:00Z' },
  ])
  assert.equal(logo.gid, '2', 'de bijlage met "logo" in de naam hoort te winnen')
})

test('zonder naamhint wint de nieuwste', () => {
  const { logo, meerdere } = kiesLogo([
    { gid: '1', name: 'oud.png', created_at: '2026-09-01T10:00:00Z' },
    { gid: '2', name: 'nieuw.png', created_at: '2026-09-02T10:00:00Z' },
  ])
  assert.equal(logo.gid, '2')
  assert.equal(meerdere, true, 'dat er gekozen is moet gemeld kunnen worden')
})

test('hangt er niets bruikbaars, dan zegt de uitkomst wat er wel hing', () => {
  const bijlagen = [{ gid: '1', name: 'huisstijl.pdf' }]
  const { logo, onbruikbaar } = kiesLogo(bijlagen)
  assert.equal(logo, null)
  assert.deepEqual(onbruikbaar, bijlagen)

  // En helemaal geen bijlagen is iets anders dan een onbruikbare: dan is het
  // wachten, niet mislukken.
  assert.deepEqual(kiesLogo([]), { logo: null, onbruikbaar: [] })
})

test('een logo wordt een data-URI die de engine kan zetten', async () => {
  const uri = await logoDataUri({ name: 'nbc.png', buffer: readFileSync(NBC_LOGO) })
  assert.match(uri, /^data:image\/png;base64,/)
  assert.ok(uri.length > 1000, 'dat is wel een erg klein logo')
})

test('een svg gaat ongemoeid mee', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>')
  const uri = await logoDataUri({ name: 'merk.svg', buffer: svg })
  assert.match(uri, /^data:image\/svg\+xml;base64,/)
  assert.equal(Buffer.from(uri.split(',')[1], 'base64').toString(), svg.toString())
})

test('een menu-aanvraag krijgt altijd de subtaak waar het logo aan hangt', () => {
  const a = { aanvraag_types: ['menu_scherm'], anders_tekst: '', event: 'Deloitte',
              event_datum: '2026-10-20', naam: 'Wendy' }
  const namen = subtaskTitles(a)
  assert.deepEqual(namen, ['Menu scherm Deloitte'])
  assert.ok(namen.every(isMenuSubtaak), 'de worker moet zijn eigen subtaak terugvinden')
  assert.ok(MENU_SUBTAAK_NAMEN.length >= 2, 'menukaart en menuscherm horen er allebei in')
})

// ── Het scherm in de kleuren van de opdrachtgever ────────────────────
// Ongeveer een op de vijf wil dat. De kleuren komen uit de huisstijl-brief die de
// andere Routine al van de website van de opdrachtgever heeft gehaald: één basiskleur
// voor de blobs, en het accent waarin de kopjes en het bestek-icoon staan. Het verloop
// oranje-naar-teal hoort bij NBC; een andere opdrachtgever krijgt één vlak.

const brief = (...kleuren) => ({ colors: kleuren })

test('de blobs krijgen de hoofdkleur, en niet meer dan één kleur', () => {
  const keuze = merkKleuren(brief(
    { hex: '#00a3e0', role: 'accent', name: 'lichtblauw' },
    { hex: '#5b2d8e', role: 'primary', name: 'paars' },
  ))
  assert.equal(keuze.basis, '#5b2d8e', 'de hoofdkleur hoort het grote vlak te worden')
  assert.equal(keuze.boven, undefined, 'er is geen tweede blobkleur meer')
  assert.equal(keuze.onder, undefined)
  assert.match(keuze.uitleg, /paars/, 'de comment moet de kleur noemen om na te kijken')
})

test('één bruikbare merkkleur is genoeg', () => {
  // Achtergrond en tekst staan altijd in een huisstijl-brief, maar een witte blob
  // valt weg tegen het scherm en een zwarte maakt er een gat van. Blijft er daarna
  // één kleur over, dan is dat precies wat we nodig hebben.
  const keuze = merkKleuren(brief(
    { hex: '#ffffff', role: 'background' },
    { hex: '#111111', role: 'text' },
    { hex: '#5b2d8e', role: 'primary' },
  ))
  assert.equal(keuze.reden, undefined, 'met één kleur kan het scherm gewoon mee')
  assert.equal(keuze.basis, '#5b2d8e')
})

test('blijft er geen enkele kleur over, dan blijft het NBC', () => {
  const keuze = merkKleuren(brief(
    { hex: '#fdfdfd', role: 'primary' },
    { hex: '#020202', role: 'secondary' },
  ))
  assert.ok(keuze.reden)
  assert.match(keuze.reden, /geen kleur/)
})

test('zonder huisstijl-brief blijft het bij de NBC-kleuren', () => {
  assert.ok(merkKleuren(null).reden)
  assert.ok(merkKleuren({}).reden)
})

test('de kopjes en het icoon krijgen de accentkleur', () => {
  const keuze = merkKleuren(brief(
    { hex: '#5b2d8e', role: 'primary', name: 'paars' },
    { hex: '#00a3e0', role: 'accent', name: 'lichtblauw' },
  ))
  // Een accentkleur is bedoeld om mee te benadrukken; dat is wat een kopje doet.
  assert.equal(keuze.accent, '#00a3e0')
  assert.match(keuze.uitleg, /kopjes en het bestek-icoon worden/)
})

test('zonder leesbaar accent krijgen de kopjes de basiskleur, niet NBC-oranje', () => {
  // De blobs kunnen best licht zijn, maar een kopje op een wit scherm moet leesbaar
  // blijven - dat is de houvast op zo'n scherm. Toch halen we daar geen NBC-oranje
  // voor terug: dat is een kleur die bij deze opdrachtgever nergens staat.
  const keuze = merkKleuren(brief(
    { hex: '#ffe600', role: 'primary', name: 'geel' },
    { hex: '#ffd1dc', role: 'accent', name: 'roze' },
  ))
  assert.equal(keuze.basis, '#ffe600', 'als blob kan geel prima')
  assert.equal(keuze.accent, '#ffe600', 'de kopjes blijven in het merk')
  assert.doesNotMatch(keuze.uitleg, /NBC/)
  assert.match(keuze.uitleg, /licht/, 'dat geel zwak uitvalt als kopje moet wel gemeld worden')
})

test('de kleuren worden gevonden in wat er echt in de database staat', () => {
  // aanvragen.brand_result is { brief, assets, ... } - de kleuren zitten dus een laag
  // dieper dan de brief zelf. Werd dat niet uitgepakt, dan kwam er nul kleuren uit en
  // kreeg elk scherm stilletjes de NBC-huisstijl.
  const brand_result = {
    brief: { colors: [{ hex: '#5b2d8e', role: 'primary', name: 'paars' },
                      { hex: '#00a3e0', role: 'accent', name: 'lichtblauw' }] },
    assets: [],
    extracted_at: '2026-10-05T09:00:00Z',
  }
  const keuze = merkKleuren(brand_result)
  assert.equal(keuze.reden, undefined, 'brand_result hoort gewoon te werken')
  assert.equal(keuze.basis, '#5b2d8e')
  assert.equal(keuze.accent, '#00a3e0')
})

// ── Kleuren die Marketing zelf intikt ────────────────────────────────
// Niet elke opdrachtgever heeft een website waar een huisstijl uit te halen valt. Dan
// tikt Marketing de kleur in het Asana-veld "Menukleuren", en die wint van wat er
// automatisch gevonden is.

test('een leeg veld betekent: gewoon de opgehaalde huisstijl', () => {
  for (const leeg of [null, undefined, '', '   ']) assert.equal(handmatigeKleuren(leeg), null, JSON.stringify(leeg))
})

test('één hexcode kleurt de blobs en de kopjes', () => {
  const keuze = handmatigeKleuren('#5b2d8e')
  assert.equal(keuze.basis, '#5b2d8e')
  assert.equal(keuze.accent, '#5b2d8e')
})

test('een derde hexcode kleurt de tekst', () => {
  const keuze = handmatigeKleuren('#0a1f3d, #f7941e, #1d1d1b')
  assert.equal(keuze.basis, '#0a1f3d')
  assert.equal(keuze.accent, '#f7941e')
  assert.equal(keuze.tekst, '#1d1d1b', 'titel, gerechten en het dieetwens-blok')
  assert.match(keuze.uitleg, /titel, de gerechten en het dieetwens-blok worden #1d1d1b/)

  // Zonder derde code blijft de tekst zoals in het ontwerp: zwart.
  assert.equal(handmatigeKleuren('#0a1f3d, #f7941e').tekst, null)
  // En de opgehaalde huisstijl levert er sowieso geen: dat is een bewuste keuze.
  assert.equal(merkKleuren(brief({ hex: '#0a1f3d', role: 'primary' },
                                 { hex: '#333333', role: 'text' })).tekst, null)
})

test('een lichte tekstkleur wordt gezet, maar wel gemeld', () => {
  // De ingredienten staan in een dunne snit op klein formaat; die vallen als eerste weg.
  const keuze = handmatigeKleuren('#0a1f3d #f7941e #ffe600')
  assert.equal(keuze.tekst, '#ffe600')
  assert.match(keuze.uitleg, /dunne snit/)
})

test('twee hexcodes: de eerste de blobs, de tweede de kopjes', () => {
  // Hoe iemand ze scheidt mag niet uitmaken; een hekje vergeten ook niet.
  for (const tekst of ['#5b2d8e, #ff6600', '5b2d8e #ff6600', '#5B2D8E/#FF6600', '#5b2d8e; #ff6600']) {
    const keuze = handmatigeKleuren(tekst)
    assert.equal(keuze.basis, '#5b2d8e', tekst)
    assert.equal(keuze.accent, '#ff6600', tekst)
  }
  // De korte schrijfwijze van drie tekens hoort ook te werken.
  assert.equal(handmatigeKleuren('#abc').basis, '#aabbcc')
})

test('een kleur die niet kan wordt gezet, maar wel gemeld', () => {
  // Wat hier staat is een opdracht van iemand die het scherm zelf nakijkt. Weigeren is
  // dan betuttelend; stil doorgaan is erger, want een witte blob zie je niet.
  const wit = handmatigeKleuren('#ffffff')
  assert.equal(wit.basis, '#ffffff')
  assert.match(wit.uitleg, /vallen weg tegen het scherm/)
  assert.match(handmatigeKleuren('#5b2d8e #ffe600').uitleg, /zwak uitvallen/)

  // Donker is geen fout - een merk met een diep marineblauw hoort zo op het scherm -
  // maar het wordt wel zwaarder dan het NBC-ontwerp. Beide routes moeten dat hetzelfde
  // zeggen; eerder las dezelfde kleur uit het veld als "bijna zwart" en uit de huisstijl
  // als "heel donker".
  const zwartVeld = handmatigeKleuren('#0b1f35')
  const zwartBrief = merkKleuren(brief({ hex: '#0b1f35', role: 'primary', name: 'marineblauw' }))
  for (const uitleg of [zwartVeld.uitleg, zwartBrief.uitleg]) {
    assert.match(uitleg, /heel donker/)
    assert.doesNotMatch(uitleg, /bijna zwart|gat in het scherm/)
  }
})

test('staat er geen kleur in het veld, dan zegt de melding wat er wel stond', () => {
  const keuze = handmatigeKleuren('donkerblauw graag')
  assert.ok(keuze.reden)
  assert.match(keuze.reden, /donkerblauw graag/)
  assert.match(keuze.reden, /#5b2d8e/, 'laat zien hoe het wel moet')
})

test('het veld wordt in Asana op gid gevonden, en anders op naam', () => {
  const cfg = { fields: { menukleuren: { gid: '123', name: 'Menukleuren', type: 'text' } } }
  const taak = { custom_fields: [
    { gid: '999', name: 'Website', text_value: 'nbc.nl' },
    { gid: '123', name: 'Menukleuren', text_value: ' #5b2d8e ' },
  ] }
  assert.equal(veldTekst(taak, 'menukleuren', cfg), '#5b2d8e', 'spaties eromheen horen weg')

  // Is de velden-workflow nog niet gedraaid, dan staat de gid er nog niet. Op naam
  // terugvallen scheelt een scherm dat zonder reden in NBC-kleuren uitkomt - ook als er
  // helemaal geen configuratie is, want onze sleutel is de veldnaam in kleine letters.
  assert.equal(veldTekst(taak, 'menukleuren', { fields: { menukleuren: { name: 'Menukleuren' } } }), '#5b2d8e')
  assert.equal(veldTekst(taak, 'menukleuren', { fields: {} }), '#5b2d8e')
  assert.equal(veldTekst(taak, 'menukleuren', null), '#5b2d8e')

  // Een taak van een project waar het veld niet op staat, levert niets op.
  assert.equal(veldTekst({ custom_fields: [{ gid: '999', name: 'Website', text_value: 'nbc.nl' }] }, 'menukleuren', cfg), null)

  // Leeg veld, geen veld, geen taak: allemaal gewoon niets.
  assert.equal(veldTekst({ custom_fields: [{ gid: '123', text_value: '' }] }, 'menukleuren', cfg), null)
  assert.equal(veldTekst({ custom_fields: [] }, 'menukleuren', cfg), null)
  assert.equal(veldTekst(null, 'menukleuren', cfg), null)
})
