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
import { mergeIntoNotes, renderComment, renderHuisstijlSection } from '../lib/notes.mjs'

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
