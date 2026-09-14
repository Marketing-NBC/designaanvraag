/** Plain-fetch fallback als de browser de site niet kan laden (blokkade, timeout). */
import { log } from './config.mjs'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'))
  return m ? m[1] : null
}

export async function fetchFallback(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.7' }, redirect: 'follow', signal: AbortSignal.timeout(20_000) })
  const html = (await res.text()).slice(0, 2_000_000)
  const base = res.url || url
  const abs = (u) => {
    try {
      return new URL(u, base).href
    } catch {
      return null
    }
  }
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? null
  const tags = html.match(/<(?:link|meta|img)\b[^>]*>/gi) ?? []
  const icons = [], logos = [], google = []
  let og = null, themeColor = null, description = null
  let idx = 0
  for (const t of tags) {
    const rel = attr(t, 'rel') ?? ''
    const href = attr(t, 'href')
    if (/icon/i.test(rel) && href) icons.push({ rel, href: abs(href), sizes: attr(t, 'sizes') })
    if (/fonts\.googleapis\.com/i.test(href ?? '')) {
      try {
        for (const f of new URL(href).searchParams.getAll('family')) google.push(f.split(':')[0].replace(/\+/g, ' '))
      } catch {}
    }
    const prop = attr(t, 'property') ?? attr(t, 'name') ?? ''
    if (/^og:image$/i.test(prop)) og = abs(attr(t, 'content'))
    if (/^theme-color$/i.test(prop)) themeColor = attr(t, 'content')
    if (/^description$/i.test(prop)) description = attr(t, 'content')
    if (/^<img/i.test(t)) {
      const src = attr(t, 'src') ?? attr(t, 'data-src')
      const hint = [attr(t, 'alt'), attr(t, 'class'), attr(t, 'id'), src].filter(Boolean).join(' ')
      if (src && /logo/i.test(hint)) logos.push({ index: idx++, kind: 'img', src: abs(src), hint, top: 0, width: 0, height: 0, inHeader: /header|nav/i.test(hint), inHomeLink: false })
    }
  }
  const hexes = {}
  for (const m of html.matchAll(/#([0-9a-f]{6})\b/gi)) {
    const h = `#${m[1].toLowerCase()}`
    hexes[h] = (hexes[h] ?? 0) + 1
  }
  const customProps = {}
  for (const m of html.matchAll(/(--[a-z0-9-]*(?:color|primary|secondary|accent|brand)[a-z0-9-]*)\s*:\s*([^;}]+)/gi)) customProps[m[1]] = m[2].trim()
  log('fallback via fetch', { status: res.status, title, logos: logos.length })
  return {
    status: res.status,
    finalUrl: base,
    dom: {
      title,
      description,
      lang: html.match(/<html[^>]*lang=["']([^"']+)/i)?.[1] ?? null,
      logos,
      icons,
      og_image: og,
      jsonld_logos: [],
      fonts: { loaded: [], computed: [], google, adobe: /use\.typekit\.net/i.test(html), fontFace: [...html.matchAll(/font-family\s*:\s*["']([^"']+)["']/gi)].map((m) => m[1]) },
      colorsRaw: {
        backgrounds: Object.entries(hexes).map(([value, n]) => ({ value, weight: n })),
        texts: [],
        borders: [],
        cta: [],
        customProps,
        themeColor,
      },
      cross_origin_sheets: [],
      manifest: null,
      page_height: null,
    },
  }
}
