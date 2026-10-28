import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kiesMenuBron } from '../menu/bron.mjs'

const inhoud = { pakket: 'lunch-basic', secties: [{ kop: 'Broodjes', gerechten: [{ naam: 'Clubsandwich', ingredienten: ['kip'] }] }] }
const aanvraag = { menu_inhoud: inhoud, menu_tekst: 'Broodjes\n• Clubsandwich | kip' }
const beschrijving = (menu) => `<body><h2>Menu</h2>\n<blockquote>${menu}</blockquote>\n<hr/>\n<h2>Huisstijl</h2></body>`

test('onveranderd in de beschrijving: het menu uit het formulier, met zijn opbouw', () => {
  const bron = kiesMenuBron({ beschrijvingHtml: beschrijving('Broodjes\n• Clubsandwich | kip'), aanvraag })
  assert.deepEqual(bron, { inhoud, tekst: aanvraag.menu_tekst, notitie: null })
})

test('aangepast in de beschrijving: dat menu wordt gegenereerd', () => {
  const bron = kiesMenuBron({ beschrijvingHtml: beschrijving('Broodjes\n• Clubsandwich | kip\n• Wrap | zalm'), aanvraag })
  assert.equal(bron.inhoud, null)
  assert.equal(bron.tekst, 'Broodjes\n• Clubsandwich | kip\n• Wrap | zalm')
  assert.match(bron.notitie, /taakbeschrijving/)
})

test('geen kopje Menu in de beschrijving: terug naar het formulier, en dat wordt gemeld', () => {
  const bron = kiesMenuBron({ beschrijvingHtml: '<body>Losse taak</body>', aanvraag })
  assert.equal(bron.inhoud, inhoud)
  assert.match(bron.notitie, /geen kopje "Menu"/)
})

test('beschrijving niet gelezen en geen menu in het formulier: niets, en geen melding', () => {
  assert.deepEqual(kiesMenuBron({ beschrijvingHtml: null, aanvraag: { menu_inhoud: null, menu_tekst: '' } }), { inhoud: null, tekst: null, notitie: null })
})

import { herstelOnderdelen } from '../menu/bron.mjs'

const bibliotheek = [
  { naam: 'Tartelettes', onderdelen: [{ naam: 'Rundertartaar', toelichting: ['umamicrème'] }, { naam: 'Taleggio (vega)' }] },
  { naam: 'Pão de queijo', ingredienten: ['kaasballetjes'] },
]

test('een ongewijzigde regel met onderdelen krijgt zijn opbouw terug', () => {
  const [sectie] = herstelOnderdelen([{ kop: 'Op tafel', gerechten: [{ naam: 'Tartelettes • Rundertartaar • Taleggio (vega)' }, { naam: 'Wrap', ingredienten: ['zalm'] }] }], bibliotheek)
  assert.deepEqual(sectie.gerechten[0], bibliotheek[0])
  assert.notEqual(sectie.gerechten[0], bibliotheek[0], 'een kopie, zodat de bibliotheek niet meeverandert')
  assert.deepEqual(sectie.gerechten[1], { naam: 'Wrap', ingredienten: ['zalm'] })
})

test('een bewerkte regel blijft zoals hij getypt is', () => {
  const [sectie] = herstelOnderdelen([{ kop: null, gerechten: [{ naam: 'Tartelettes • Rundertartaar • Brie' }] }], bibliotheek)
  assert.deepEqual(sectie.gerechten[0], { naam: 'Tartelettes • Rundertartaar • Brie' })
})
