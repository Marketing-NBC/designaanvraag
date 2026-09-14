import { chromium } from 'playwright'
import { chromiumExecutable, log } from './config.mjs'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

const CONSENT_SELECTORS = [
  '#onetrust-accept-btn-handler',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  '#CybotCookiebotDialogBodyButtonAccept',
  '.cc-btn.cc-allow',
  '.cc-accept, .cookie-accept, .cookies-accept, .js-cookie-accept',
  '[data-cookiebanner="accept_button"]',
  'button:has-text("Alles accepteren")',
  'button:has-text("Alle cookies accepteren")',
  'button:has-text("Accepteer alle")',
  'button:has-text("Accepteren")',
  'button:has-text("Ik ga akkoord")',
  'button:has-text("Akkoord")',
  'button:has-text("Accept all")',
  'button:has-text("Accept All")',
  'button:has-text("Accept")',
  'a:has-text("Accepteren")',
]

/** Script dat in de pagina draait en alle signalen verzamelt. */
function domExtractor() {
  const vw = innerWidth, vh = innerHeight
  const consentSel = '[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="onetrust" i],[id*="CybotCookiebot" i]'
  const isVisible = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return false
    const cs = getComputedStyle(el)
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'
  }
  const inConsent = (el) => Boolean(el.closest(consentSel))
  const hintOf = (el) => [el.id, el.className && typeof el.className === 'string' ? el.className : '', el.getAttribute('alt'), el.getAttribute('title'), el.getAttribute('aria-label'), el.getAttribute('src'), el.getAttribute('href')].filter(Boolean).join(' ').slice(0, 300)

  // ── Logo-kandidaten ──────────────────────────────────────────────
  const cands = []
  const seen = new Set()
  let candIndex = 0
  const addCand = (el, kind, src) => {
    if (!el || seen.has(el)) return
    if (!isVisible(el) || inConsent(el)) return
    seen.add(el)
    const r = el.getBoundingClientRect()
    const home = el.closest('a[href="/"], a[href="./"], a[href="#"], a[href^="/?"], a[href$=".nl/"], a[href$=".com/"], a[href$=".nl"], a[href$=".com"], a[href$=".be/"], a[href$=".eu/"]')
    const header = el.closest('header, nav, [role="banner"], .header, #header, .navbar, .site-header, .topbar, .masthead')
    el.setAttribute('data-nbc-cand', String(candIndex))
    cands.push({
      index: candIndex++,
      kind,
      src: src ?? null,
      inline_svg: kind === 'svg' ? el.outerHTML.slice(0, 200_000) : null,
      hint: hintOf(el) + ' ' + (el.closest('a')?.getAttribute('aria-label') ?? ''),
      top: Math.round(r.top + scrollY),
      left: Math.round(r.left),
      width: Math.round(r.width),
      height: Math.round(r.height),
      inHeader: Boolean(header),
      inHomeLink: Boolean(home),
    })
  }
  const scopes = document.querySelectorAll('header, nav, [role="banner"], .header, #header, .navbar, .site-header, .topbar, .masthead, a[href="/"]')
  for (const scope of scopes) {
    for (const el of scope.querySelectorAll('img, svg, picture img, [style*="background-image"]')) {
      if (el.tagName === 'IMG') addCand(el, 'img', el.currentSrc || el.src)
      else if (el.tagName === 'svg') addCand(el, 'svg', null)
      else {
        const bg = getComputedStyle(el).backgroundImage.match(/url\(["']?([^"')]+)["']?\)/)
        if (bg) addCand(el, 'bg', new URL(bg[1], location.href).href)
      }
    }
  }
  for (const el of document.querySelectorAll('img[alt*="logo" i], img[src*="logo" i], img[class*="logo" i], img[id*="logo" i], [class*="logo" i] img, [class*="logo" i] svg, svg[class*="logo" i], [id*="logo" i] img, [id*="logo" i] svg')) {
    const tag = el.tagName === 'svg' ? 'svg' : 'img'
    if (el.getBoundingClientRect().top + scrollY <= 900) addCand(el, tag, tag === 'img' ? el.currentSrc || el.src : null)
  }

  const abs = (u) => {
    try {
      return new URL(u, location.href).href
    } catch {
      return null
    }
  }
  const icons = []
  for (const l of document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"], link[rel="mask-icon"]')) {
    icons.push({ rel: l.getAttribute('rel'), href: abs(l.getAttribute('href')), sizes: l.getAttribute('sizes'), type: l.getAttribute('type') })
  }
  const og = document.querySelector('meta[property="og:image"], meta[name="og:image"]')?.getAttribute('content')
  const jsonld = []
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.textContent)
      const walk = (n) => {
        if (!n || typeof n !== 'object') return
        if (Array.isArray(n)) return n.forEach(walk)
        if (n.logo) jsonld.push(typeof n.logo === 'string' ? n.logo : n.logo.url ?? n.logo.contentUrl ?? null)
        if (n['@graph']) walk(n['@graph'])
      }
      walk(data)
    } catch {}
  }

  // ── Fonts ───────────────────────────────────────────────────────
  const loaded = []
  try {
    for (const f of document.fonts) if (f.status === 'loaded') loaded.push({ family: f.family, weight: f.weight, style: f.style })
  } catch {}
  const textLen = (el) => Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim().length).reduce((a, b) => a + b, 0)
  const computed = []
  const roleSel = { h1: 'h1', h2: 'h2', h3: 'h3', body: 'p, li, span, td, div', button: 'button, a.button, a.btn, [class*="btn"], [class*="button"], input[type="submit"]', nav: 'nav a, header a' }
  for (const [role, sel] of Object.entries(roleSel)) {
    let n = 0
    for (const el of document.querySelectorAll(sel)) {
      if (n++ > 600) break
      if (!isVisible(el) || inConsent(el)) continue
      const len = role === 'body' ? textLen(el) : el.textContent.trim().length
      if (len === 0) continue
      const cs = getComputedStyle(el)
      computed.push({ role, family: cs.fontFamily, weight: cs.fontWeight, size: cs.fontSize, weightScore: Math.min(len, 400) })
    }
  }
  for (const c of computed) {
    c.weight_score = c.weightScore
    delete c.weightScore
  }
  const google = []
  for (const l of document.querySelectorAll('link[href*="fonts.googleapis.com"]')) {
    try {
      const u = new URL(l.href)
      for (const fam of u.searchParams.getAll('family')) google.push(fam.split(':')[0].replace(/\+/g, ' '))
    } catch {}
  }
  const adobe = Boolean(document.querySelector('link[href*="use.typekit.net"], script[src*="use.typekit.net"], link[href*="use.typekit.com"]'))
  const fontFace = []
  const crossOriginSheets = []
  const customProps = {}
  const propRe = /color|primary|secondary|accent|brand|theme|main|highlight/i
  for (const sheet of document.styleSheets) {
    let rules
    try {
      rules = sheet.cssRules
    } catch {
      if (sheet.href) crossOriginSheets.push(sheet.href)
      continue
    }
    const walkRules = (list, depth) => {
      if (depth > 3) return
      for (const rule of list) {
        if (rule.type === 5 /* FONT_FACE */) {
          const fam = rule.style.getPropertyValue('font-family')
          if (fam) fontFace.push(fam.replace(/["']/g, '').trim())
        } else if (rule.type === 1 /* STYLE */ && /(^|,)\s*(:root|html|body)\s*(,|$)/.test(rule.selectorText ?? '')) {
          for (const name of rule.style) {
            if (name.startsWith('--') && propRe.test(name)) customProps[name] = rule.style.getPropertyValue(name).trim()
          }
        } else if (rule.cssRules) walkRules(rule.cssRules, depth + 1)
      }
    }
    walkRules(rules, 0)
  }

  // ── Kleuren ─────────────────────────────────────────────────────
  const backgrounds = [], texts = [], borders = [], cta = []
  let count = 0
  for (const el of document.querySelectorAll('body *')) {
    if (count++ > 5000) break
    if (!isVisible(el) || inConsent(el)) continue
    if (['SCRIPT', 'STYLE', 'SVG', 'PATH'].includes(el.tagName)) continue
    const r = el.getBoundingClientRect()
    const area = Math.min(r.width * r.height, vw * vh * 0.6)
    const cs = getComputedStyle(el)
    const bg = cs.backgroundColor
    if (bg && !/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)/.test(bg) && bg !== 'transparent') backgrounds.push({ value: bg, weight: area / 1000 + 1 })
    const len = textLen(el)
    if (len > 0) texts.push({ value: cs.color, weight: Math.min(len, 300) })
    const bw = parseFloat(cs.borderTopWidth) || 0
    if (bw > 0 && cs.borderTopStyle !== 'none') borders.push({ value: cs.borderTopColor, weight: (r.width + r.height) / 50 })
  }
  for (const el of document.querySelectorAll('button, a.button, a.btn, [class*="btn"], [class*="button"], input[type="submit"], a[class*="cta" i]')) {
    if (!isVisible(el) || inConsent(el)) continue
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    cta.push({ value: cs.backgroundColor, weight: Math.max(1, (r.width * r.height) / 500), role: 'cta-bg' })
    cta.push({ value: cs.color, weight: 1, role: 'cta-text' })
  }
  const themeColor = document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null
  const manifest = document.querySelector('link[rel="manifest"]')?.href ?? null

  return {
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null,
    lang: document.documentElement.lang || null,
    logos: cands,
    icons,
    og_image: og ? abs(og) : null,
    jsonld_logos: jsonld.filter(Boolean),
    fonts: { loaded, computed, google, adobe, fontFace },
    colorsRaw: { backgrounds, texts, borders, cta, customProps, themeColor },
    cross_origin_sheets: crossOriginSheets.slice(0, 10),
    manifest,
    page_height: document.documentElement.scrollHeight,
  }
}

async function dismissConsent(page) {
  let clicked = null
  for (const sel of CONSENT_SELECTORS) {
    try {
      const loc = page.locator(sel).first()
      if (await loc.isVisible({ timeout: 250 })) {
        await loc.click({ timeout: 1500 })
        clicked = sel
        await page.waitForTimeout(600)
        break
      }
    } catch {}
  }
  // Wat overblijft aan grote vaste overlays: verbergen.
  const hidden = await page.evaluate(() => {
    let n = 0
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el)
      if ((cs.position === 'fixed' || cs.position === 'sticky') && parseInt(cs.zIndex || '0', 10) >= 1000) {
        const r = el.getBoundingClientRect()
        const cover = (r.width * r.height) / (innerWidth * innerHeight)
        const consentish = /cookie|consent|gdpr|privacy|modal|overlay|popup/i.test(el.id + ' ' + el.className)
        if (cover > 0.2 && (consentish || cover > 0.5)) {
          el.style.setProperty('display', 'none', 'important')
          n++
        }
      }
    }
    return n
  })
  return { clicked, hidden }
}

/**
 * Laadt de pagina en verzamelt screenshots + DOM-signalen.
 * @returns {Promise<{ page, context, browser, dom, finalUrl, status, consent }>}
 */
export async function openSite(url, { viewport = { width: 1440, height: 900 }, timeoutMs = 35_000 } = {}) {
  // In een sandbox met uitgaande proxy (HTTPS_PROXY) moet Chromium die ook gebruiken.
  const proxyServer = process.env.HTTPS_PROXY || process.env.https_proxy || null
  const browser = await chromium.launch({
    executablePath: chromiumExecutable(),
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
    proxy: proxyServer ? { server: proxyServer, bypass: process.env.NO_PROXY || 'localhost,127.0.0.1' } : undefined,
  })
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    locale: 'nl-NL',
    timezoneId: 'Europe/Amsterdam',
    userAgent: UA,
    reducedMotion: 'reduce',
    ignoreHTTPSErrors: true,
  })
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false })
  })
  const page = await context.newPage()
  page.setDefaultTimeout(timeoutMs)
  let response
  try {
    response = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs })
  } catch (e) {
    await browser.close()
    throw new Error(`Pagina laden mislukt: ${e.message.split('\n')[0]}`)
  }
  const status = response?.status() ?? null
  if (status && status >= 400) {
    await browser.close()
    throw new Error(`Pagina gaf HTTP ${status}`)
  }
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' }).catch(() => {})
  await page.waitForTimeout(1200)
  const consent = await dismissConsent(page)
  // Lazy loading triggeren: stapsgewijs scrollen en terug.
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight
    for (let y = 0; y < Math.min(h, 6000); y += 700) {
      scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 120))
    }
    scrollTo(0, 0)
  })
  await page.waitForTimeout(800)
  await page.evaluate(() => document.fonts?.ready).catch(() => {})
  const dom = await page.evaluate(domExtractor)
  log('pagina geladen', { status, title: dom.title, logos: dom.logos.length, consent })
  return { page, context, browser, dom, finalUrl: page.url(), status, consent }
}

export async function screenshots(page, outDir, sharp) {
  const { join } = await import('node:path')
  const heroBuf = await page.screenshot({ type: 'png' })
  await sharp(heroBuf).resize({ width: 1440 }).png().toFile(join(outDir, 'hero.png'))
  const headerBuf = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1440, height: 180 } })
  await sharp(headerBuf).resize({ width: 1800 }).png().toFile(join(outDir, 'header.png'))
  const fullBuf = await page.screenshot({ type: 'png', fullPage: true })
  const meta = await sharp(fullBuf).metadata()
  const maxH = 4000 * 2
  let full = sharp(fullBuf)
  if ((meta.height ?? 0) > maxH) full = full.extract({ left: 0, top: 0, width: meta.width, height: maxH })
  await full.resize({ width: 1200 }).png().toFile(join(outDir, 'page.png'))
  return { hero: 'hero.png', header: 'header.png', page: 'page.png', heroBuf }
}

/** Element-screenshot van een logo-kandidaat op 2× met transparante achtergrond. */
export async function candidateShot(page, index) {
  const loc = page.locator(`[data-nbc-cand="${index}"]`).first()
  try {
    return await loc.screenshot({ type: 'png', omitBackground: true, timeout: 5000 })
  } catch {
    return null
  }
}

/** Origineel bestand ophalen via de browsercontext (zelfde cookies/referer); zonder browser via fetch. */
export async function fetchViaPage(page, url, maxBytes = 3_000_000) {
  try {
    if (page) {
      const res = await page.request.get(url, { timeout: 15_000, maxRedirects: 5 })
      if (!res.ok()) return null
      const buf = await res.body()
      if (buf.length > maxBytes) return null
      return { buffer: buf, contentType: res.headers()['content-type'] ?? '' }
    }
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > maxBytes) return null
    return { buffer: buf, contentType: res.headers.get('content-type') ?? '' }
  } catch {
    return null
  }
}
