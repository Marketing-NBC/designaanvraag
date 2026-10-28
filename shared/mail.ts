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
 * De omlijsting van elke mail: een kop in NBC-teal en daaronder de inhoud. Opgebouwd met tabellen en
 * inline stijlen, want Outlook negeert vrijwel alles wat moderner is. Pockota en Area Normal zijn er
 * in een mail niet; Arial is de veilige terugval.
 */
export function mailOpmaak(kop: string, inhoud: string, voet = 'Automatische melding van het designaanvraag-formulier.'): string {
  return `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f1ef;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f1ef;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#0e0e0e;">
<tr><td style="background:#229d96;color:#ffffff;padding:20px 24px;font-size:20px;font-weight:bold;">${escapeHtml(kop)}</td></tr>
<tr><td style="padding:24px;">${inhoud}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #eaebec;color:#828b8d;font-size:12px;">${escapeHtml(voet)}</td></tr>
</table>
</td></tr>
</table>
</body></html>`
}

/** Een knop naar de Asana-taak; een gewone link als terugval voor wie geen opmaak ziet. */
export function knop(href: string, tekst: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 4px;"><tr>`
    + `<td style="background:#229d96;border-radius:4px;">`
    + `<a href="${escapeHtml(href)}" style="display:inline-block;padding:10px 18px;color:#ffffff;text-decoration:none;font-weight:bold;">${escapeHtml(tekst)}</a>`
    + `</td></tr></table>`
}

/** Een tabel met label en waarde per regel. De waarde is al HTML; escapen doet de aanroeper. */
export function gegevensTabel(rijen: [string, string][]): string {
  const tr = rijen
    .map(([k, v]) => `<tr><td style="padding:4px 16px 4px 0;color:#596165;vertical-align:top;white-space:nowrap;">${escapeHtml(k)}</td>`
      + `<td style="padding:4px 0;vertical-align:top;">${v}</td></tr>`)
    .join('')
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${tr}</table>`
}

/** Een opvallend blok voor iets wat niet goed ging, of spoed. */
export function waarschuwingBlok(html: string): string {
  return `<div style="background:#fff4de;border-left:4px solid #f6a304;padding:12px 16px;margin:0 0 20px;">${html}</div>`
}

/**
 * Een citaat: wat de collega zelf typte. Regeleinden worden <br>, want Outlook kent geen
 * `white-space: pre-wrap`.
 */
export function citaat(tekst: string): string {
  return `<div style="background:#e9f5f4;padding:12px 16px;margin:4px 0 0;">${escapeHtml(tekst).replace(/\r?\n/g, '<br>')}</div>`
}
