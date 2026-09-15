/** Kleur- en fontheuristieken op de ruwe DOM-signalen. Pure functies, geen I/O. */

export function parseCssColor(s) {
  if (!s) return null
  const v = String(s).trim().toLowerCase()
  if (v === 'transparent' || v === 'currentcolor' || v === 'inherit') return null
  let m = v.match(/^#([0-9a-f]{3,8})$/)
  if (m) {
    let h = m[1]
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    return { r, g, b, a }
  }
  m = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/)
  if (m) {
    let a = 1
    if (m[4] !== undefined) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
    return { r: +m[1], g: +m[2], b: +m[3], a }
  }
  m = v.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)$/)
  if (m) {
    const [r, g, b] = hslToRgb(+m[1], +m[2] / 100, +m[3] / 100)
    let a = 1
    if (m[4] !== undefined) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
    return { r, g, b, a }
  }
  return null
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

export function toHex({ r, g, b }) {
  return '#' + [r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')
}

export function rgbToHsl({ r, g, b }) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
  else if (max === g) h = ((b - r) / d + 2) * 60
  else h = ((r - g) / d + 4) * 60
  return { h, s, l }
}

export function isNeutral(c) {
  const { s, l } = rgbToHsl(c)
  return s < 0.1 || l > 0.96 || l < 0.06
}

function dist(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2)
}

/**
 * Clustert gewogen kleuren (afstand ≤ threshold in RGB) en sorteert op gewicht.
 * @param {{ color: {r,g,b,a}, weight: number, tag?: string }[]} samples
 */
export function clusterColors(samples, threshold = 14) {
  const clusters = []
  for (const s of samples) {
    if (!s.color || s.color.a < 0.15) continue
    const hit = clusters.find((c) => dist(c.rep, s.color) <= threshold)
    if (hit) {
      hit.weight += s.weight
      if (s.tag) hit.tags[s.tag] = (hit.tags[s.tag] ?? 0) + s.weight
    } else clusters.push({ rep: { r: s.color.r, g: s.color.g, b: s.color.b }, weight: s.weight, tags: s.tag ? { [s.tag]: s.weight } : {} })
  }
  clusters.sort((a, b) => b.weight - a.weight)
  const total = clusters.reduce((n, c) => n + c.weight, 0) || 1
  return clusters.map((c) => ({
    hex: toHex(c.rep),
    share: +(c.weight / total).toFixed(4),
    neutral: isNeutral(c.rep),
    tags: Object.fromEntries(Object.entries(c.tags).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +(v / c.weight).toFixed(2)])),
  }))
}

/** Verwerkt de ruwe kleurmetingen uit de browser tot lijsten voor de brief. */
export function summarizeColors(raw) {
  const toSamples = (arr, tag) => arr.map((x) => ({ color: parseCssColor(x.value), weight: x.weight, tag: x.role ?? tag })).filter((s) => s.color)
  const all = clusterColors([...toSamples(raw.backgrounds, 'bg'), ...toSamples(raw.texts, 'text'), ...toSamples(raw.borders, 'border')])
  const cta = clusterColors(toSamples(raw.cta, 'cta'))
  const custom = {}
  for (const [name, value] of Object.entries(raw.customProps ?? {})) {
    const c = parseCssColor(value)
    if (c) custom[name] = toHex(c)
  }
  return {
    brand: all.filter((c) => !c.neutral).slice(0, 12),
    neutrals: all.filter((c) => c.neutral).slice(0, 6),
    cta: cta.slice(0, 4),
    custom_properties: custom,
    theme_color: raw.themeColor ? (parseCssColor(raw.themeColor) ? toHex(parseCssColor(raw.themeColor)) : raw.themeColor) : null,
  }
}

const GENERIC = /^(arial|helvetica|helvetica neue|times|times new roman|georgia|verdana|tahoma|trebuchet ms|system-ui|-apple-system|blinkmacsystemfont|segoe ui|roboto|ui-sans-serif|ui-serif|sans-serif|serif|monospace|inherit|initial)$/i

export function firstFamily(stack) {
  return String(stack ?? '')
    .split(',')[0]
    .replace(/["']/g, '')
    .trim()
}

export function summarizeFonts(raw) {
  const loaded = [...new Set((raw.loaded ?? []).map((f) => f.family.replace(/["']/g, '')))]
  // Per rol en familie: hoe prominent is die familie (weight_score = hoeveelheid tekst), en welke
  // CSS-gewichten komen erin voor. Die twee zijn verschillende dingen en mogen niet op één hoop.
  const byRole = {}
  for (const c of raw.computed ?? []) {
    const fam = firstFamily(c.family)
    if (!fam) continue
    const score = Number(c.weight_score) || 0
    byRole[c.role] ??= {}
    const hit = (byRole[c.role][fam] ??= { score: 0, weights: new Map() })
    hit.score += score
    const w = Number(c.weight)
    if (Number.isFinite(w) && w > 0) hit.weights.set(w, (hit.weights.get(w) ?? 0) + score)
  }
  const roles = {}
  for (const [role, fams] of Object.entries(byRole)) {
    roles[role] = Object.entries(fams)
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, 3)
      .map(([family, hit]) => {
        const byShare = [...hit.weights.entries()].sort((a, b) => b[1] - a[1])
        return {
          family,
          weight: byShare.length ? byShare[0][0] : null,
          weights: byShare.map(([w]) => w).sort((a, b) => a - b),
          generic: GENERIC.test(family),
          loaded: loaded.some((l) => l.toLowerCase() === family.toLowerCase()),
        }
      })
  }
  return {
    loaded,
    by_role: roles,
    google_fonts: raw.google ?? [],
    adobe_fonts: Boolean(raw.adobe),
    font_face: [...new Set(raw.fontFace ?? [])],
  }
}

/** Score-heuristiek voor logo-kandidaten (hoger = waarschijnlijker het echte logo). */
export function scoreLogo(c, hostBrand) {
  let s = 0
  if (c.inHeader) s += 3
  if (c.inHomeLink) s += 2
  if (/logo/i.test(c.hint)) s += 3
  if (hostBrand && new RegExp(hostBrand, 'i').test(c.hint)) s += 2
  if (c.top <= 160) s += 2
  else if (c.top <= 320) s += 1
  if (c.width >= 48 && c.width <= 520) s += 1
  if (c.width > 800 || c.height > 320) s -= 3
  if (c.width < 24 || c.height < 12) s -= 3
  if (c.kind === 'svg' || /\.svg(\?|$)/i.test(c.src ?? '')) s += 1
  if (c.kind === 'jsonld') s += 2
  if (c.kind === 'apple-touch-icon') s += 0
  if (c.kind === 'og:image') s -= 1
  if (c.kind === 'favicon') s -= 1
  return s
}

export function brandWordFromHost(hostname) {
  const parts = hostname.replace(/^www\./, '').split('.')
  const word = parts.length > 1 ? parts[parts.length - 2] : parts[0]
  return word && word.length >= 3 ? word : null
}
