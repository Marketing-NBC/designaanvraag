/**
 * Mail versturen via Microsoft 365 (Microsoft Graph, `sendMail`). Gedeeld door de edge functions
 * (de meldingen) en scripts/weekmail.mjs (het weekoverzicht). Dependency-vrij: alleen `fetch`, zodat
 * zowel Deno als Node hem zonder pakketten kan laden.
 *
 * De app logt in met een eigen client secret (client credentials) en verstuurt namens één postvak,
 * de afzender. Wat de beheerder daarvoor in Microsoft 365 moet klaarzetten staat in de README onder
 * "Mail instellen".
 */

export interface MailBericht {
  aan: string[]
  onderwerp: string
  html: string
  /** Waar "Beantwoorden" naartoe gaat; leeg = de afzender. */
  antwoordAan?: string[]
  bijlagen?: MailBijlage[]
}

export interface MailBijlage {
  naam: string
  mime: string
  bytes: Uint8Array
}

/**
 * Tot zoveel aan bijlagen gaat alles in één verzoek mee. Graph neemt hooguit 4 MB per verzoek aan,
 * en base64 maakt een bestand een derde groter; dit laat ruimte voor de rest van de mail.
 */
export const MAIL_IN_EEN_KEER_BYTES = 2_500_000
/** Stukken waarin een groot bestand naar Graph gaat: een veelvoud van 320 KiB, onder de 4 MB. */
const UPLOAD_STUK_BYTES = 320 * 1024 * 9

export interface MailClient {
  verstuur(bericht: MailBericht): Promise<void>
}

export interface GraphMailConfig {
  tenantId: string
  clientId: string
  clientSecret: string
  /** Het postvak waar de mail vandaan komt, bijvoorbeeld designaanvraag@nbcevents.nl. */
  afzender: string
}

type Fetch = typeof fetch

const TIMEOUT_MS = 10_000

export function createGraphMail(cfg: GraphMailConfig, doFetch: Fetch = fetch): MailClient {
  // Een token is een uur geldig. Een edge function blijft vaak even warm, dus bewaren scheelt een
  // rondje naar Microsoft per melding; vijf minuten marge zodat hij niet halverwege verloopt.
  let token: { waarde: string; geldigTot: number } | null = null

  async function haalToken(): Promise<string> {
    if (token && token.geldigTot > Date.now()) return token.waarde
    const res = await doFetch(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string }
    if (!res.ok || !body.access_token) {
      // De eerste regel van error_description is de leesbare uitleg ("AADSTS7000215: Invalid client
      // secret provided"); de rest is een trace-id en tijdstempel.
      const uitleg = body.error_description?.split('\n')[0] ?? body.error ?? 'onbekende fout'
      throw new Error(`Inloggen bij Microsoft mislukt (${res.status}: ${uitleg})`)
    }
    token = { waarde: body.access_token, geldigTot: Date.now() + ((body.expires_in ?? 3600) - 300) * 1000 }
    return token.waarde
  }

  const postvak = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.afzender)}`

  /** Eén verzoek aan Graph met JSON. Gooit bij een fout, met de code en uitleg van Microsoft. */
  async function graph(pad: string, method: string, body: unknown, wat: string, timeout = TIMEOUT_MS): Promise<Record<string, unknown>> {
    const res = await doFetch(`${postvak}${pad}`, {
      method,
      headers: { Authorization: `Bearer ${await haalToken()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    })
    if (!res.ok) {
      const fout = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } }
      if (res.status === 401) token = null
      const uitleg = [fout.error?.code, fout.error?.message].filter(Boolean).join(': ') || 'onbekende fout'
      throw new Error(`${wat} mislukt (${res.status}: ${uitleg})`)
    }
    return (await res.json().catch(() => ({}))) as Record<string, unknown>
  }

  function bericht({ aan, onderwerp, html, antwoordAan }: MailBericht): Record<string, unknown> {
    const adressen = (lijst: string[]) => lijst.map((address) => ({ emailAddress: { address } }))
    return {
      subject: onderwerp,
      body: { contentType: 'HTML', content: html },
      toRecipients: adressen(aan),
      ...(antwoordAan?.length ? { replyTo: adressen(antwoordAan) } : {}),
    }
  }

  const bijlageJson = (b: MailBijlage) => ({
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: b.naam,
    contentType: b.mime,
    contentBytes: naarBase64(b.bytes),
  })

  /**
   * Grote bijlagen kunnen niet in één verzoek. Dan eerst een concept, de bestanden er in stukken
   * aan, en daarna versturen. Daarvoor heeft de app naast Mail.Send ook Mail.ReadWrite nodig; zie
   * "Mail instellen" in de README.
   */
  async function verstuurInStappen(m: MailBericht): Promise<void> {
    let concept: string
    try {
      concept = String((await graph('/messages', 'POST', bericht(m), 'Concept aanmaken')).id ?? '')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/\(403/.test(msg)) {
        throw new Error(`${msg}. Voor bijlagen boven de ${Math.round(MAIL_IN_EEN_KEER_BYTES / 1_000_000)} MB heeft de app het recht Mail.ReadWrite nodig; zie "Mail instellen" in de README.`)
      }
      throw e
    }
    if (!concept) throw new Error('Concept aanmaken mislukt (geen id van Microsoft)')
    try {
      for (const b of m.bijlagen ?? []) {
        if (b.bytes.length < MAIL_IN_EEN_KEER_BYTES) {
          await graph(`/messages/${concept}/attachments`, 'POST', bijlageJson(b), `Bijlage "${b.naam}"`)
          continue
        }
        const sessie = await graph(`/messages/${concept}/attachments/createUploadSession`, 'POST', {
          AttachmentItem: { attachmentType: 'file', name: b.naam, size: b.bytes.length, contentType: b.mime },
        }, `Upload van "${b.naam}" starten`)
        const uploadUrl = String(sessie.uploadUrl ?? '')
        if (!uploadUrl) throw new Error(`Upload van "${b.naam}" starten mislukt (geen uploadadres)`)
        for (let van = 0; van < b.bytes.length; van += UPLOAD_STUK_BYTES) {
          const stuk = b.bytes.subarray(van, Math.min(van + UPLOAD_STUK_BYTES, b.bytes.length))
          // Het uploadadres is zelf de sleutel; een Authorization-header hoort er juist niet bij.
          const res = await doFetch(uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${van}-${van + stuk.length - 1}/${b.bytes.length}` },
            body: stuk as Uint8Array<ArrayBuffer>,
            signal: AbortSignal.timeout(60_000),
          })
          if (!res.ok) throw new Error(`Upload van "${b.naam}" mislukt (${res.status})`)
        }
      }
      await graph(`/messages/${concept}/send`, 'POST', undefined, 'Mail versturen', 30_000)
    } catch (e) {
      // Een half concept hoort niet in het postvak te blijven hangen.
      await graph(`/messages/${concept}`, 'DELETE', undefined, 'Concept opruimen').catch(() => {})
      throw e
    }
  }

  return {
    async verstuur(m) {
      if (!m.aan.length) throw new Error('Geen ontvanger opgegeven')
      const bijlagen = m.bijlagen ?? []
      const totaal = bijlagen.reduce((n, b) => n + b.bytes.length, 0)
      if (totaal > MAIL_IN_EEN_KEER_BYTES) return verstuurInStappen(m)
      await graph('/sendMail', 'POST', {
        message: { ...bericht(m), ...(bijlagen.length ? { attachments: bijlagen.map(bijlageJson) } : {}) },
        // Geen kopie in Verzonden items: daar kijkt niemand, en zo loopt dat postvak niet vol.
        saveToSentItems: false,
      }, 'Mail versturen', bijlagen.length ? 30_000 : TIMEOUT_MS)
    },
  }
}

/** Bytes als base64, in stukken: een heel bestand in één keer laat `String.fromCharCode` omvallen. */
export function naarBase64(bytes: Uint8Array): string {
  let binair = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binair += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binair)
}

/** Escapen voor HTML in een mail. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Het lettertype, op elk element apart. De klassieke Outlook (die bij NBC en Green Village overal
 * draait) rendert mail met Word, en Word laat een lettertype niet doorlopen naar een tabel in een
 * tabel: zonder dit staan de gegevens in Calibri of Aptos en de rest in Arial. Pockota en Area
 * Normal zijn er in een mail niet; Arial is de veilige terugval.
 */
export const LETTER = 'font-family:Arial,Helvetica,sans-serif;'

/** De kleuren van een mail: kop en knop, het lichte vlak achter een citaat, en links. */
export interface Thema {
  kleur: string
  /** Tekst op `kleur`. */
  opKleur: string
  tint: string
  link: string
}

/**
 * Per locatie. Green Village is bijna zwart groen, met witte tekst op de kop en de knop. De lichte
 * vlakken en de links hebben een olijftint: links in de GV-kleur zelf zouden niet van gewone tekst
 * te onderscheiden zijn.
 */
export const THEMAS: Record<string, Thema> = {
  nbc: { kleur: '#229d96', opKleur: '#ffffff', tint: '#e9f5f4', link: '#165e5a' },
  green_village: { kleur: '#23251b', opKleur: '#ffffff', tint: '#f1f2ec', link: '#5c6049' },
}

/** Het thema van een locatie; onbekend of leeg is NBC. */
export function themaVoor(locatie: string | null | undefined): Thema {
  return (locatie && THEMAS[locatie]) || THEMAS.nbc
}

/**
 * De omlijsting van elke mail: een kop in NBC-teal en daaronder de inhoud. Opgebouwd met tabellen,
 * inline stijlen en ruimte via `padding` op cellen, want Word negeert `padding` en `margin` op
 * vrijwel al het andere. Het stijlblok bovenin is een vangnet voor het lettertype van alles wat
 * een eigen stijl mist, zoals lijstjes uit Asana.
 */
export function mailOpmaak(
  kop: string,
  inhoud: string,
  voet = 'Automatische melding van het designaanvraag-formulier.',
  thema: Thema = THEMAS.nbc,
): string {
  return `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body,table,td,p,a,li,span,strong,em,h1,h2{${LETTER}}</style>
</head>
<body style="margin:0;padding:0;background:#f1f1ef;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f1f1ef" style="background:#f1f1ef;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="max-width:600px;width:100%;background:#ffffff;">
<tr><td bgcolor="${thema.kleur}" style="background:${thema.kleur};color:${thema.opKleur};padding:20px 24px;${LETTER}font-size:20px;line-height:26px;font-weight:bold;">${escapeHtml(kop)}</td></tr>
<tr><td style="padding:24px;${LETTER}font-size:15px;line-height:22px;color:#0e0e0e;">${inhoud}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #eaebec;${LETTER}color:#828b8d;font-size:12px;line-height:18px;">${escapeHtml(voet)}</td></tr>
</table>
</td></tr>
</table>
</body></html>`
}

/**
 * Een knop. De opvulling zit op de cel en niet op de link: Word negeert `padding` op een link,
 * en dan staat er een strak gekleurd vlak zonder lucht om de tekst. De ruimte erboven zit om
 * dezelfde reden in een buitencel in plaats van in een `margin`.
 */
export function knop(href: string, tekst: string, thema: Thema = THEMAS.nbc): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:20px 0 4px;">`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>`
    + `<td align="center" bgcolor="${thema.kleur}" style="background:${thema.kleur};border-radius:4px;padding:12px 24px;">`
    + `<a href="${escapeHtml(href)}" style="${LETTER}font-size:15px;line-height:20px;color:${thema.opKleur};text-decoration:none;font-weight:bold;display:inline-block;">${escapeHtml(tekst)}</a>`
    + `</td></tr></table></td></tr></table>`
}

/** Een tabel met label en waarde per regel. De waarde is al HTML; escapen doet de aanroeper. */
export function gegevensTabel(rijen: [string, string][]): string {
  const cel = `${LETTER}font-size:15px;line-height:22px;vertical-align:top;`
  const tr = rijen
    .map(([k, v]) => `<tr><td valign="top" style="${cel}padding:3px 16px 3px 0;color:#596165;white-space:nowrap;">${escapeHtml(k)}</td>`
      + `<td valign="top" style="${cel}padding:3px 0;color:#0e0e0e;">${v}</td></tr>`)
    .join('')
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${tr}</table>`
}

/**
 * Ruimte boven en onder een stuk mail. Via `padding` op een cel, want Word negeert `margin` op een
 * `<div>` en een tabel.
 */
export function ruimte(html: string, boven: number, onder = 0): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:${boven}px 0 ${onder}px;">${html}</td></tr></table>`
}

/**
 * Een gekleurd vlak met lucht eromheen, als tabel: Word negeert `padding` op een `<div>`, en dan
 * plakt de tekst tegen de rand van het vlak. `boven` en `onder` is de ruimte buiten het vlak.
 */
export function vlak(html: string, o: { achtergrond: string; rand?: string; boven?: number; onder?: number }): string {
  const rand = o.rand ? `border-left:4px solid ${o.rand};` : ''
  return ruimte(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>`
      + `<td bgcolor="${o.achtergrond}" style="background:${o.achtergrond};${rand}padding:12px 16px;${LETTER}font-size:15px;line-height:22px;color:#0e0e0e;">${html}</td>`
      + `</tr></table>`,
    o.boven ?? 0,
    o.onder ?? 0,
  )
}

/** Een opvallend blok voor iets wat niet goed ging, of spoed. */
export function waarschuwingBlok(html: string): string {
  return vlak(html, { achtergrond: '#fff4de', rand: '#f6a304', onder: 20 })
}

/**
 * Een citaat: wat de collega zelf typte. Regeleinden worden <br>, want Outlook kent geen
 * `white-space: pre-wrap`.
 */
export function citaat(tekst: string, thema: Thema = THEMAS.nbc): string {
  return vlak(escapeHtml(tekst).replace(/\r?\n/g, '<br>'), { achtergrond: thema.tint, boven: 4 })
}
