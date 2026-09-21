import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { chromiumExecutable, REPO_DIR, WORKER_DIR, parseArgs, log } from '../lib/config.mjs'

const FONTS = [
  'Pockota-Light', 'Pockota-Regular', 'Pockota-Medium',
  'AreaNormal-Regular', 'AreaNormal-Semibold', 'AreaNormal-Extrabold',
]

/**
 * Rendert één menuscherm (3840×2160 PNG) uit een data-object.
 * @param {object} data  { title, brand:{accent,blobTop,blobBottom,logo,logoBg}, columns:[[{heading,items:[{name,ingredients,tag}]}]] }
 * @returns {Promise<Buffer>} PNG-bytes
 */
export async function renderMenu(data) {
  let html = readFileSync(join(WORKER_DIR, 'menu', 'template.html'), 'utf8')

  // NBC-fonts inline als data-URI (about:blank mag geen file:// laden).
  const fontDir = join(REPO_DIR, 'web', 'src', 'assets', 'fonts')
  for (const f of FONTS) {
    try {
      const b64 = readFileSync(join(fontDir, `${f}.otf`)).toString('base64')
      html = html.split(`{{FONT_DIR}}/${f}.otf`).join(`data:font/otf;base64,${b64}`)
    } catch {
      /* zonder NBC-font valt het scherm terug op Georgia/Arial */
    }
  }

  // Data veilig injecteren vóór het template-script draait.
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  html = html.replace('<script>', `<script>window.__MENU__ = ${json};</script>\n<script>`)

  const browser = await chromium.launch({ executablePath: chromiumExecutable(), args: ['--no-sandbox'] })
  // deviceScaleFactor 2 → 1920×1080 CSS wordt 3840×2160 pixels (4K, 16:9).
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 })
  await page.setContent(html, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts?.ready).catch(() => {})
  await page.waitForTimeout(400)
  const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1920, height: 1080 } })
  await browser.close()
  return png
}

// CLI: node worker/menu/render.mjs --data worker/menu/voorbeeld-diner.json --out worker/menu/out.png
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs()
  const dataPath = args.data || join(WORKER_DIR, 'menu', 'voorbeeld-diner.json')
  const outPath = args.out || join(WORKER_DIR, 'menu', 'out.png')
  const data = JSON.parse(readFileSync(dataPath, 'utf8'))
  log(`Menuscherm renderen uit ${dataPath}`)
  const png = await renderMenu(data)
  writeFileSync(outPath, png)
  log(`Klaar → ${outPath} (${(png.length / 1024).toFixed(0)} KB)`)
}
