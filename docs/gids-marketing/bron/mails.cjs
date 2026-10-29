// Screenshots van de nagemaakte mails (zie mails.mts), met oranje kaders → bron/shots/.
//   node docs/gids-marketing/bron/mails.cjs
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')
const OUT = path.join(__dirname, 'shots')
fs.mkdirSync(OUT, { recursive: true })

async function mark(p, marks) {
  for (const [loc, n, pad = 6] of marks) {
    const bb = await loc.first().boundingBox()
    if (!bb) { console.log('geen box voor', n); continue }
    await p.evaluate(({ bb, n, pad }) => {
      const d = document.createElement('div')
      Object.assign(d.style, { position: 'absolute', left: (bb.x - pad + scrollX) + 'px', top: (bb.y - pad + scrollY) + 'px', width: (bb.width + 2 * pad) + 'px', height: (bb.height + 2 * pad) + 'px',
        border: '3px solid #E8590C', borderRadius: '10px', zIndex: 99999, pointerEvents: 'none', boxSizing: 'border-box' })
      const b = document.createElement('div'); b.textContent = n
      Object.assign(b.style, { position: 'absolute', right: '-15px', top: '-15px', width: '28px', height: '28px', borderRadius: '50%', background: '#E8590C', color: '#fff',
        font: '800 16px/28px "Area Normal", Arial, sans-serif', textAlign: 'center', boxShadow: '0 0 0 2px #fff' })
      d.appendChild(b); document.body.appendChild(d)
    }, { bb, n, pad })
  }
}

;(async () => {
  require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'mails.mts')], { stdio: 'inherit' })
  const b = await chromium.launch({ args: ['--no-proxy-server'] })
  const mails = {
    'mail-nieuwe-aanvraag': (p, m) => [[p.locator('.kop'), 1], [m.locator('td', { hasText: /^Spoed$/ }).locator('xpath=..'), 2, 4], [m.locator('a', { hasText: 'Open de taak in Asana' }).locator('xpath=ancestor::table[1]'), 3]],
    'mail-aanvulling': (p, m) => [[m.getByText('Deze taak was al afgerond').locator('xpath=ancestor::td[1]'), 1], [m.getByText('Graag de kopjes').locator('xpath=ancestor::td[1]'), 2], [m.locator('a', { hasText: 'Open de taak in Asana' }).locator('xpath=ancestor::table[1]'), 3]],
    'mail-weekmail': (p, m) => [[m.getByText('Deadlines deze week', { exact: true }), 1, 4], [m.getByText('Let op', { exact: true }), 2, 4], [m.getByText('Volgende week', { exact: true }), 3, 4]],
  }
  for (const [naam, marks] of Object.entries(mails)) {
    const p = await b.newPage({ viewport: { width: 820, height: 900 }, deviceScaleFactor: 2 })
    await p.goto('file://' + path.join(__dirname, 'mail', naam.replace('mail-', '') + '.html'))
    const m = p.frameLocator('iframe')
    await m.locator('body').waitFor()
    await p.waitForTimeout(400)
    // Het venster precies zo hoog als de mail
    const hoogte = await p.evaluate(() => { const f = document.querySelector('iframe'); f.style.height = '50px'; const h = f.contentDocument.documentElement.scrollHeight; f.style.height = h + 'px'; return f.getBoundingClientRect().top + h })
    await p.setViewportSize({ width: 820, height: Math.ceil(hoogte) })
    await mark(p, marks(p, m))
    await p.screenshot({ path: path.join(OUT, naam + '.png') })
    await p.close()
  }
  await b.close()
})().catch((e) => { console.error(e); process.exit(1) })
