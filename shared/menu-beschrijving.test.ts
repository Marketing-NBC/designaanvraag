import { describe, expect, it } from 'vitest'
import { menuSleutel, menuUitBeschrijving, vervangMenuInBeschrijving } from './menu-beschrijving'

const beschrijving = [
  '<body><strong>Event:</strong> Zorgcongres',
  '<h2>Wensen en bijzonderheden</h2>',
  '<blockquote>Graag in de huisstijl.</blockquote>',
  '',
  '<h2>Menu</h2>',
  '<blockquote>Broodjes',
  '• Clubsandwich | kip | bacon',
  '• Caprese &amp; pesto | mozzarella</blockquote>',
  '',
  '<hr/>',
  '<h2>Huisstijl</h2>',
  'Wordt opgehaald.</body>',
].join('\n')

describe('menu uit de taakbeschrijving', () => {
  it('leest wat onder het kopje Menu staat, tot de streep van de huisstijl', () => {
    expect(menuUitBeschrijving(beschrijving)).toBe('Broodjes\n• Clubsandwich | kip | bacon\n• Caprese & pesto | mozzarella')
  })

  it('een lijstje dat iemand in Asana maakte, wordt weer bolletjes', () => {
    const html = '<body><h2>Menu</h2><blockquote>Broodjes<ul><li>Clubsandwich | kip</li><li>Wrap</li></ul></blockquote><hr/></body>'
    expect(menuUitBeschrijving(html)).toBe('Broodjes\n• Clubsandwich | kip\n• Wrap')
  })

  it('zonder kopje Menu is er niets', () => {
    expect(menuUitBeschrijving('<body><h2>Wensen</h2>x</body>')).toBeNull()
    expect(menuUitBeschrijving(null)).toBeNull()
    expect(menuUitBeschrijving('<body><h2>Menu</h2>\n\n<hr/></body>')).toBeNull()
  })

  it('vergelijken los van witruimte en soort bolletje', () => {
    expect(menuSleutel('Broodjes\n  - Clubsandwich |  kip\n\n')).toBe(menuSleutel('Broodjes\n• Clubsandwich | kip'))
    expect(menuSleutel('Broodjes\n• Wrap')).not.toBe(menuSleutel('Broodjes\n• Clubsandwich'))
  })
})

describe('menu in de taakbeschrijving zetten', () => {
  it('vervangt het oude menu en laat de rest staan', () => {
    const nieuw = vervangMenuInBeschrijving(beschrijving, 'Lunch\n• Soep & brood')
    expect(menuUitBeschrijving(nieuw)).toBe('Lunch\n• Soep & brood')
    expect(nieuw).toContain('<blockquote>Lunch\n• Soep &amp; brood</blockquote>')
    expect(nieuw).toContain('<h2>Wensen en bijzonderheden</h2>')
    expect(nieuw).toContain('<h2>Huisstijl</h2>')
    expect(nieuw).not.toContain('Clubsandwich')
  })

  it('zonder menu komt het voor de streep van de huisstijl', () => {
    const html = '<body><h2>Wensen</h2>x\n<hr/>\n<h2>Huisstijl</h2>y</body>'
    const nieuw = vervangMenuInBeschrijving(html, 'Lunch\n• Soep')
    expect(nieuw.indexOf('<h2>Menu</h2>')).toBeLessThan(nieuw.indexOf('<hr/>'))
    expect(menuUitBeschrijving(nieuw)).toBe('Lunch\n• Soep')
  })

  it('zonder streep achteraan', () => {
    expect(vervangMenuInBeschrijving('<body>x</body>', 'Lunch')).toBe('<body>x<h2>Menu</h2>\n<blockquote>Lunch</blockquote>\n</body>')
  })
})
