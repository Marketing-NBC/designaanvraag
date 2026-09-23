/**
 * De beschrijving van de Asana-taak wordt door twee onderdelen geschreven: de edge function maakt
 * hem, de worker zet de huisstijl erin. Asana leest `html_notes` als strikte XML en weigert de hele
 * update bij één niet-gesloten tag. Deze test controleert dat het resultaat geldige XML blijft en
 * alleen tags gebruikt die Asana toestaat.
 *
 *   node --test --experimental-strip-types worker/test/
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderNotes } from '../../supabase/functions/_shared/notes.ts'
import { menuIsBruikbaar, mergeIntoNotes, renderComment, renderHuisstijlSection, renderMenuComment, renderMenuFailureComment } from '../lib/notes.mjs'

/** Tags die Asana accepteert in html_notes. */
const TOEGESTAAN = new Set(['body', 'h1', 'h2', 'strong', 'em', 'u', 's', 'code', 'pre', 'ol', 'ul', 'li', 'a', 'blockquote', 'hr', 'img'])
/** Tags die zelfsluitend moeten zijn (<hr/>, <img/>). */
const LEEG = new Set(['hr', 'img'])

/** Minimale XML-welgevormdheidscheck: elke tag open/dicht in de juiste volgorde. */
function controleerXml(xml) {
  const stack = []
  const re = /<(\/?)([a-zA-Z0-9]+)([^>]*?)(\/?)>/g
  let m
  while ((m = re.exec(xml))) {
    const [, sluit, tag, attrs, zelfsluitend] = m
    assert.ok(TOEGESTAAN.has(tag), `tag <${tag}> is niet toegestaan in Asana html_notes`)
    if (LEEG.has(tag)) {
      assert.ok(zelfsluitend === '/', `<${tag}> moet zelfsluitend zijn (<${tag}/>), anders weigert Asana de hele beschrijving`)
      continue
    }
    if (sluit) assert.equal(stack.pop(), tag, `</${tag}> sluit de verkeerde tag`)
    else if (zelfsluitend !== '/') stack.push(tag)
    // Attributen alleen op <a> en <img>.
    if (attrs.trim() && !['a', 'img'].includes(tag)) assert.fail(`<${tag}> heeft attributen; dat staat Asana niet toe`)
  }
  assert.equal(stack.length, 0, `niet gesloten tags: ${stack.join(', ')}`)
}

const aanvraag = {
  naam: 'Wendy',
  event: 'Zorgcongres "groot" & <duidelijk>',
  event_datum: '2026-11-20',
  deadline: '2026-11-10',
  website: 'https://www.zorgcongres.nl/',
  schijf_locatie: 'G:\\Events\\2026\\Zorg',
  aanvraag_types: ['led_kolom', 'vlaggen'],
  anders_tekst: '',
  design_modus: 'custom',
  omschrijving: 'Graag <groot> & duidelijk, met "quotes".',
  menu_tekst: '',
}

const brief = {
  brand_name: 'Zorgcongres 2026',
  logo: { candidate_index: 0, reason: 'Wordmerk in de header', prefers_dark_bg: false },
  colors: [
    { hex: '#0b3d91', role: 'primary', name: 'marineblauw', source: 'hero' },
    { hex: '#ff7a00', role: 'accent', name: 'oranje', source: 'CTA & <knop>' },
  ],
  fonts: {
    heading: { family: 'Montserrat', weight: '700', source: 'google', fallback: 'Arial' },
    body: { family: 'Open Sans', weight: '400', source: 'google', fallback: 'Arial' },
  },
  style_notes: ['Strak & zakelijk', 'Oranje <spaarzaam> gebruiken'],
  confidence: 0.9,
  warnings: ['Logo alleen als PNG gevonden'],
}

const attachmentNames = { logo: 'logo-zorgcongres.svg', kaart: 'huisstijl-kaart-zorgcongres.png', screenshot: 'screenshot-zorgcongres.png' }

test('de beschrijving van de edge function is geldige XML', () => {
  const { html } = renderNotes(aanvraag, { aanvraagId: '11111111-2222-4333-8444-555555555555' })
  controleerXml(html)
})

test('de huisstijl komt in de beschrijving en die blijft geldige XML', () => {
  const { html } = renderNotes(aanvraag, { aanvraagId: '11111111-2222-4333-8444-555555555555' })
  const section = renderHuisstijlSection({ brief, website: aanvraag.website, attachmentNames, kaartGid: '123456789', sessionUrl: 'https://claude.ai/code/session_x' })
  const merged = mergeIntoNotes(html, section)
  assert.ok(merged, 'de markerregel onder "Huisstijl" moet gevonden worden')
  controleerXml(merged)
  assert.match(merged, /#0b3d91/)
  assert.doesNotMatch(merged, /Wordt automatisch opgehaald/, 'de markerregel hoort vervangen te zijn')
})

test('zonder markerregel wordt de sectie achteraan toegevoegd, nog steeds geldig', () => {
  const section = renderHuisstijlSection({ brief, website: aanvraag.website, attachmentNames, kaartGid: '123456789', sessionUrl: null })
  const merged = mergeIntoNotes('<body><strong>Aanvrager:</strong> Wendy</body>', section)
  controleerXml(merged)
  assert.match(merged, /<h2>Huisstijl<\/h2>/)
})

test('de comment gebruikt geen img of koppen', () => {
  const comment = renderComment({ brief, website: aanvraag.website, attachmentNames })
  controleerXml(comment)
  assert.doesNotMatch(comment, /<img|<h1|<h2/)
})

// ── Menuschermen ─────────────────────────────────────────────────────
// De meldingen van de opmaak-engine gaan naar Asana, niet naar een logbestand.
// Ze bevatten gerechtnamen van opdrachtgevers, dus met alle tekens die daarin
// kunnen zitten; een losse & of < zou de hele comment laten weigeren.

const menuMeldingen = {
  botsingen: [{ tekst: 'saus van "rode" ui & kruiden', waar: 'de dieetwens-regel', baseline: 1547.4,
                sectie: 'Hoofdgerecht', gerecht: 'Langzaam gegaarde kalfsrollade' }],
  overloop: ['<Chocoladetrifle> valt onder de onderrand'],
  structuur: ['Sectie "Op tafel" heeft 2 gerechten in het basisontwerp, 3 in de inhoud.'],
  regelval: ['"kip | kimchi & komkommer" valt over 3 regels, het basisontwerp had er 2.'],
  opmaak: ['"Tartelettes" wordt als opsomming gezet <met bullets>'],
}

test('een scherm waar tekst overheen loopt wordt niet goedgekeurd', () => {
  // Tekst over een blob, de logobalk of de dieetwens-regel mag nooit. Zo'n scherm
  // gaat niet als resultaat de deur uit; de comment moet daar geen twijfel over
  // laten en zeggen welke gang ingekort moet worden.
  assert.equal(menuIsBruikbaar(menuMeldingen), false)
  const html = renderMenuComment({
    pakket: 'diner-4gangen',
    bestandsnaam: 'NIET-BRUIKBAAR-menuscherm-diner-4gangen.png',
    meldingen: menuMeldingen,
    invoer: ['De kopjes komen precies overeen met diner-4gangen.'],
    sessionUrl: 'https://claude.ai/code/session_x?a=1&b=2',
  })
  controleerXml(html)
  assert.ok(html.includes('kan zo niet gebruikt worden'), html)
  assert.ok(html.includes('Hoofdgerecht'), 'de comment zegt niet welke gang te lang is')
  assert.ok(html.includes('Langzaam gegaarde kalfsrollade'))
  assert.ok(!html.includes('<img'), 'Asana weigert img in een comment')
})

test('alleen afwijkingen zonder botsing blijven een bruikbaar scherm', () => {
  const meldingen = { botsingen: [], overloop: [], structuur: menuMeldingen.structuur,
                      regelval: menuMeldingen.regelval, opmaak: menuMeldingen.opmaak }
  assert.equal(menuIsBruikbaar(meldingen), true)
  const html = renderMenuComment({ pakket: 'buffet', bestandsnaam: 'x.png', meldingen })
  controleerXml(html)
  assert.ok(html.includes('aandachtspunten'), html)
  assert.ok(!html.includes('kan zo niet gebruikt worden'))
})

test('een menuscherm zonder meldingen leest als "klaar"', () => {
  const html = renderMenuComment({
    pakket: 'diner-4gangen',
    bestandsnaam: 'menuscherm-diner-4gangen.png',
    meldingen: { botsingen: [], overloop: [], structuur: [], regelval: [], opmaak: [] },
    sessionUrl: null,
  })
  controleerXml(html)
  assert.ok(html.includes('volgens het basisontwerp'))
  assert.ok(!html.includes('<ul>'), 'zonder meldingen hoort er geen lijstje in te staan')
})

test('een enkel aandachtspunt staat in enkelvoud', () => {
  const html = renderMenuComment({
    pakket: 'buffet',
    bestandsnaam: 'x.png',
    meldingen: { opmaak: ['iets'] },
  })
  controleerXml(html)
  assert.ok(html.includes('is 1 aandachtspunt'), html)
})

test('de mislukking-comment is geldige XML', () => {
  controleerXml(renderMenuFailureComment({ pakket: 'lunch-basic', reason: 'pakket "x" & <y> onbekend' }))
  controleerXml(renderMenuFailureComment({ pakket: null, reason: 'geen inhoud' }))
})

test('de menu-invulling komt in de beschrijving en blijft geldige XML', () => {
  const metMenu = {
    ...aanvraag,
    aanvraag_types: ['menu_scherm'],
    menu_tekst: 'Op tafel\n\n\u2022 Bruschetta & dips\n\nVoorgerecht\n\n\u2022 Hoenderfilet | gel van <basilicum>',
  }
  const { html, plain } = renderNotes(metMenu, { aanvraagId: '11111111-2222-4333-8444-555555555555' })
  controleerXml(html)
  assert.ok(html.includes('<h2>Menu</h2>'), 'het menu staat niet in de beschrijving')
  assert.ok(html.includes('&lt;basilicum&gt;'), 'de menutekst is niet ge-escaped')
  assert.ok(plain.includes('Bruschetta & dips'))
})

test('zonder menu blijft de beschrijving zoals hij was', () => {
  const { html } = renderNotes(aanvraag, { aanvraagId: '11111111-2222-4333-8444-555555555555' })
  controleerXml(html)
  assert.ok(!html.includes('<h2>Menu</h2>'))
})
