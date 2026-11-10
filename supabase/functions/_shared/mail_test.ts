import { assertEquals, assertMatch, assertRejects } from 'jsr:@std/assert@1'
import { MAIL_IN_EEN_KEER_BYTES, MailOnbevestigd, createGraphMail, naarBase64 } from './shared/mail.ts'

/** Niet echt wachten tussen het nakijken door. */
const cfg = { tenantId: 'tenant-1', clientId: 'app-1', clientSecret: 'geheim', afzender: 'designaanvraag@nbcevents.nl', wacht: () => Promise.resolve() }
const POSTVAK = 'https://graph.microsoft.com/v1.0/users/designaanvraag%40nbcevents.nl'

type Antwoord = Response | Promise<Response>

/** Wat AbortSignal.timeout geeft als een verzoek te lang duurt. */
const timeout = () => Promise.reject(new DOMException('Signal timed out.', 'TimeoutError'))
const weigering = (status: number, code = 'ErrorAccessDenied', message = 'Access is denied.') => Response.json({ error: { code, message } }, { status })

/**
 * Nep-Microsoft. Standaard: inloggen lukt, een concept krijgt id concept-1, versturen geeft 202, en
 * nakijken zegt dat het concept verstuurd is. Per stap is dat te vervangen.
 */
function fakeFetch(over: {
  token?: () => Antwoord
  concept?: () => Antwoord
  send?: () => Antwoord
  /** Antwoorden op het nakijken, op volgorde; de laatste blijft gelden. */
  nakijken?: (() => Antwoord)[]
  sendMail?: () => Antwoord
  overig?: (url: string) => Antwoord
} = {}) {
  const calls: { url: string; init: RequestInit }[] = []
  let nagekeken = 0
  const f = (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input)
    calls.push({ url, init })
    const pad = url.replace(POSTVAK, '')
    const methode = init.method ?? 'GET'
    if (url.includes('login.microsoftonline.com')) return Promise.resolve(over.token?.() ?? Response.json({ access_token: 'tok-1', expires_in: 3600 }))
    if (methode === 'POST' && pad === '/messages') return Promise.resolve(over.concept?.() ?? Response.json({ id: 'concept-1' }, { status: 201 }))
    if (methode === 'POST' && pad.endsWith('/send')) return Promise.resolve(over.send?.() ?? new Response(null, { status: 202 }))
    if (methode === 'GET' && pad.startsWith('/messages/')) {
      const lijst = over.nakijken ?? [() => Response.json({ isDraft: false })]
      return Promise.resolve(lijst[Math.min(nagekeken++, lijst.length - 1)]())
    }
    if (methode === 'POST' && pad === '/sendMail') return Promise.resolve(over.sendMail?.() ?? new Response(null, { status: 202 }))
    return Promise.resolve(over.overig?.(url) ?? new Response(null, { status: 204 }))
  }
  const paden = () => calls.filter((c) => !c.url.includes('login.')).map((c) => `${c.init.method ?? 'GET'} ${c.url.replace(POSTVAK, '')}`)
  const body = (pad: string) => JSON.parse(String(calls.find((c) => c.url === `${POSTVAK}${pad}`)!.init.body))
  return { calls, paden, body, fetch: f as typeof fetch }
}

const bericht = { aan: ['marketing@nbcevents.nl'], onderwerp: 'Test', html: '<p>Hallo</p>' }

// ── De gewone weg: concept en versturen ────────────────────────────────

Deno.test('mail gaat als concept namens de afzender en wordt dan verstuurd, met een token van de eigen tenant', async () => {
  const { calls, paden, body, fetch } = fakeFetch()
  await createGraphMail(cfg, fetch).verstuur(bericht)

  assertEquals(calls[0].url, 'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token')
  const form = new URLSearchParams(String(calls[0].init.body))
  assertEquals(form.get('grant_type'), 'client_credentials')
  assertEquals(form.get('scope'), 'https://graph.microsoft.com/.default')

  assertEquals(paden(), ['POST /messages', 'POST /messages/concept-1/send'], 'bij een gewoon antwoord niets na te kijken')
  const kop = calls[1].init.headers as Record<string, string>
  assertEquals(kop.Authorization, 'Bearer tok-1')
  assertEquals(kop.Prefer, 'IdType="ImmutableId"', 'een vaste id, zodat het concept na versturen terug te vinden is')
  const m = body('/messages')
  assertEquals(m.subject, 'Test')
  assertEquals(m.body, { contentType: 'HTML', content: '<p>Hallo</p>' })
  assertEquals(m.toRecipients, [{ emailAddress: { address: 'marketing@nbcevents.nl' } }])
})

Deno.test('het token wordt hergebruikt zolang het geldig is', async () => {
  const { calls, fetch } = fakeFetch()
  const mail = createGraphMail(cfg, fetch)
  await mail.verstuur(bericht)
  await mail.verstuur(bericht)
  assertEquals(calls.filter((c) => c.url.includes('login.')).length, 1)
})

Deno.test('een fout bij het inloggen geeft de leesbare uitleg van Microsoft', async () => {
  const { fetch } = fakeFetch({
    token: () => Response.json({ error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.\r\nTrace ID: x' }, { status: 401 }),
  })
  const e = await assertRejects(() => createGraphMail(cfg, fetch).verstuur(bericht))
  assertMatch((e as Error).message, /Inloggen bij Microsoft mislukt \(401: AADSTS7000215: Invalid client secret provided\.\s*\)/)
})

Deno.test('een timeout bij het inloggen is een gewone fout: dan is er zeker niets verstuurd', async () => {
  const { fetch } = fakeFetch({ token: timeout })
  const e = await assertRejects(() => createGraphMail(cfg, fetch).verstuur(bericht))
  assertEquals(e instanceof MailOnbevestigd, false)
  assertEquals((e as Error).message, 'Inloggen bij Microsoft mislukt (Microsoft gaf binnen 10 seconden geen antwoord)')
})

Deno.test('een weigering van het versturen komt met code en uitleg terug, en het concept wordt opgeruimd', async () => {
  const { paden, fetch } = fakeFetch({ send: () => weigering(400, 'ErrorInvalidRecipients', 'At least one recipient is not valid.') })
  const e = await assertRejects(() => createGraphMail(cfg, fetch).verstuur(bericht))
  assertEquals(e instanceof MailOnbevestigd, false, 'een weigering is zeker: niets verstuurd')
  assertEquals((e as Error).message, 'Mail versturen mislukt (400: ErrorInvalidRecipients: At least one recipient is not valid.)')
  assertEquals(paden(), ['POST /messages', 'POST /messages/concept-1/send', 'DELETE /messages/concept-1'])
})

Deno.test('na een 401 wordt er de volgende keer een nieuw token gehaald', async () => {
  let n = 0
  const { calls, fetch } = fakeFetch({ concept: () => (n++ === 0 ? new Response('{}', { status: 401 }) : Response.json({ id: 'concept-1' }, { status: 201 })) })
  const mail = createGraphMail(cfg, fetch)
  await assertRejects(() => mail.verstuur(bericht))
  await mail.verstuur(bericht)
  assertEquals(calls.filter((c) => c.url.includes('login.')).length, 2)
})

Deno.test('zonder ontvanger wordt er niets verstuurd', async () => {
  const { calls, fetch } = fakeFetch()
  await assertRejects(() => createGraphMail(cfg, fetch).verstuur({ ...bericht, aan: [] }))
  assertEquals(calls.length, 0)
})

Deno.test('kleine bijlagen en een antwoordadres gaan in één keer mee in het concept', async () => {
  const { paden, body, fetch } = fakeFetch()
  await createGraphMail(cfg, fetch).verstuur({
    ...bericht,
    antwoordAan: ['marketing@nbcevents.nl'],
    bijlagen: [{ naam: 'scherm.png', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) }],
  })
  assertEquals(paden(), ['POST /messages', 'POST /messages/concept-1/send'])
  const m = body('/messages')
  assertEquals(m.replyTo, [{ emailAddress: { address: 'marketing@nbcevents.nl' } }])
  assertEquals(m.attachments, [
    { '@odata.type': '#microsoft.graph.fileAttachment', name: 'scherm.png', contentType: 'image/png', contentBytes: 'AQID' },
  ])
})

Deno.test('een plaatje in de mail zelf gaat mee als inline-bijlage met zijn Content-ID', async () => {
  const { body, fetch } = fakeFetch()
  await createGraphMail(cfg, fetch).verstuur({
    ...bericht,
    html: '<img src="cid:torenscherm-1">',
    bijlagen: [{ naam: 'Torenscherm-preview.jpg', mime: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]), inline: 'torenscherm-1' }],
  })
  assertEquals(body('/messages').attachments, [{
    '@odata.type': '#microsoft.graph.fileAttachment', name: 'Torenscherm-preview.jpg', contentType: 'image/jpeg', contentBytes: 'AQID',
    isInline: true, contentId: 'torenscherm-1',
  }])
})

Deno.test('grote bijlagen: concept, upload in stukken, dan versturen', async () => {
  const { calls, paden, fetch } = fakeFetch({
    overig: (url) => url.endsWith('/createUploadSession')
      ? Response.json({ uploadUrl: 'https://upload.example/sessie' })
      : new Response(null, { status: url.startsWith('https://upload.') ? 200 : 201 }),
  })
  const groot = new Uint8Array(MAIL_IN_EEN_KEER_BYTES * 2)
  await createGraphMail(cfg, fetch).verstuur({
    ...bericht,
    bijlagen: [
      { naam: 'klein.png', mime: 'image/png', bytes: new Uint8Array([1]) },
      { naam: 'groot.pdf', mime: 'application/pdf', bytes: groot },
    ],
  })
  assertEquals(paden(), [
    'POST /messages',
    'POST /messages/concept-1/attachments',
    'POST /messages/concept-1/attachments/createUploadSession',
    'PUT https://upload.example/sessie',
    'PUT https://upload.example/sessie',
    'POST /messages/concept-1/send',
  ])
  const puts = calls.filter((c) => c.url.startsWith('https://upload.'))
  const ranges = puts.map((c) => (c.init.headers as Record<string, string>)['Content-Range'])
  assertEquals(ranges[1], `bytes ${320 * 1024 * 9}-${groot.length - 1}/${groot.length}`)
  assertEquals((puts[0].init.headers as Record<string, string>).Authorization, undefined, 'het uploadadres is zelf de sleutel')
})

Deno.test('mislukt een bijlage, dan is er niets verstuurd en wordt het concept opgeruimd', async () => {
  const { paden, fetch } = fakeFetch({ overig: (url) => url.endsWith('/attachments') ? weigering(413, 'ErrorMessageSizeExceeded', 'Too big') : new Response(null, { status: 204 }) })
  const e = await assertRejects(() => createGraphMail(cfg, fetch).verstuur({
    ...bericht,
    bijlagen: [{ naam: 'a.pdf', mime: 'application/pdf', bytes: new Uint8Array(MAIL_IN_EEN_KEER_BYTES - 1) }, { naam: 'b.pdf', mime: 'application/pdf', bytes: new Uint8Array(10) }],
  }))
  assertEquals(e instanceof MailOnbevestigd, false)
  assertEquals(paden(), ['POST /messages', 'POST /messages/concept-1/attachments', 'DELETE /messages/concept-1'])
})

// ── Geen antwoord op het versturen: nakijken ───────────────────────────

Deno.test('antwoordt Microsoft te laat op het versturen, maar is het concept weg verstuurd: gewoon gelukt', async () => {
  const { paden, fetch } = fakeFetch({ send: timeout })
  await createGraphMail(cfg, fetch).verstuur(bericht)
  assertEquals(paden(), ['POST /messages', 'POST /messages/concept-1/send', 'GET /messages/concept-1?$select=isDraft'])
})

Deno.test('ook bij een storing (5xx) wordt er nagekeken, en eventjes doorgekeken als het nog een concept is', async () => {
  const { paden, fetch } = fakeFetch({
    send: () => weigering(503, 'ServiceUnavailable', 'Try again'),
    nakijken: [() => Response.json({ isDraft: true }), () => timeout(), () => Response.json({ isDraft: false })],
  })
  await createGraphMail(cfg, fetch).verstuur(bericht)
  assertEquals(paden().filter((p) => p.startsWith('GET')).length, 3)
  assertEquals(paden().some((p) => p.startsWith('DELETE')), false)
})

Deno.test('blijft het een concept, dan is hij zeker niet verstuurd: gewone fout, en het concept wordt opgeruimd', async () => {
  const { paden, fetch } = fakeFetch({ send: timeout, nakijken: [() => Response.json({ isDraft: true })] })
  const e = await assertRejects(() => createGraphMail(cfg, fetch).verstuur(bericht))
  assertEquals(e instanceof MailOnbevestigd, false)
  assertMatch((e as Error).message, /Mail versturen mislukt \(Microsoft gaf binnen 30 seconden geen antwoord\); nagekeken: de mail is niet verstuurd/)
  assertEquals(paden().filter((p) => p.startsWith('GET')).length, 6, 'een halve minuut lang, elke vijf seconden')
  assertEquals(paden().at(-1), 'DELETE /messages/concept-1')
})

Deno.test('geeft ook nakijken geen uitsluitsel, dan MailOnbevestigd, en het concept blijft staan', async () => {
  const { paden, fetch } = fakeFetch({ send: timeout, nakijken: [() => timeout()] })
  const e = await assertRejects(() => createGraphMail(cfg, fetch).verstuur(bericht), MailOnbevestigd)
  assertMatch((e as Error).message, /nakijken gaf geen uitsluitsel/)
  assertEquals(paden().some((p) => p.startsWith('DELETE')), false, 'een mail die misschien onderweg is, niet weggooien')
})

// ── Zonder Mail.ReadWrite: in één keer met sendMail ────────────────────

Deno.test('zonder recht op concepten gaat de mail in één keer, zonder kopie in Verzonden items', async () => {
  const { paden, body, fetch } = fakeFetch({ concept: () => weigering(403) })
  const mail = createGraphMail(cfg, fetch)
  await mail.verstuur(bericht)
  await mail.verstuur(bericht)
  assertEquals(paden(), ['POST /messages', 'POST /sendMail', 'POST /sendMail'], 'de tweede keer niet opnieuw een concept proberen')
  const m = body('/sendMail')
  assertEquals(m.message.subject, 'Test')
  assertEquals(m.saveToSentItems, false)
})

Deno.test('zonder recht op concepten: een weigering blijft een gewone fout', async () => {
  const { fetch } = fakeFetch({ concept: () => weigering(403), sendMail: () => weigering(403) })
  const e = await assertRejects(() => createGraphMail(cfg, fetch).verstuur(bericht))
  assertEquals(e instanceof MailOnbevestigd, false)
  assertEquals((e as Error).message, 'Mail versturen mislukt (403: ErrorAccessDenied: Access is denied.)')
})

Deno.test('zonder recht op concepten: geen antwoord is MailOnbevestigd, met het recht dat het zou oplossen', async () => {
  const { fetch } = fakeFetch({ concept: () => weigering(403), sendMail: timeout })
  const e = await assertRejects(() => createGraphMail(cfg, fetch).verstuur(bericht), MailOnbevestigd)
  assertMatch((e as Error).message, /Mail\.ReadWrite/)
})

Deno.test('zonder recht op concepten zegt de fout bij grote bijlagen welk recht er mist', async () => {
  const { fetch } = fakeFetch({ concept: () => weigering(403) })
  const e = await assertRejects(() => createGraphMail(cfg, fetch).verstuur({
    ...bericht,
    bijlagen: [{ naam: 'groot.pdf', mime: 'application/pdf', bytes: new Uint8Array(MAIL_IN_EEN_KEER_BYTES + 1) }],
  }))
  assertEquals(e instanceof MailOnbevestigd, false)
  assertMatch((e as Error).message, /Mail\.ReadWrite/)
})

// ── Overig ─────────────────────────────────────────────────────────────

Deno.test('base64 in stukken geeft hetzelfde als in één keer', () => {
  const bytes = new Uint8Array(100_000).map((_, i) => i % 256)
  assertEquals(naarBase64(bytes), btoa(String.fromCharCode(...bytes)))
})

Deno.test('het gifje bovenaan komt uit de lijst van Pages, en de plek verdwijnt', async () => {
  const { body, fetch } = fakeFetch()
  const metPlek = { ...bericht, html: '<p>Hallo</p>\n<!--mailgif:akkoord-->\n<p>Doei</p>' }
  const lijst = { akkoord: [{ bestand: 'akkoord/yes.gif', breedte: 480, hoogte: 270 }] }
  await createGraphMail({ ...cfg, gifs: { lijst: () => Promise.resolve(lijst), basis: 'https://voorbeeld.nl/mail-gifs/' } }, fetch).verstuur(metPlek)
  const html = body('/messages').body.content as string
  assertMatch(html, /<img src="https:\/\/voorbeeld\.nl\/mail-gifs\/akkoord\/yes\.gif" width="480" height="270"/)
  assertEquals(html.includes('mailgif'), false)
})

Deno.test('kan de lijst niet worden opgehaald, dan gaat de mail zonder gifje', async () => {
  const { calls, body, fetch } = fakeFetch()
  const metPlek = { ...bericht, html: '<p>Hallo</p>\n<!--mailgif:akkoord-->\n' }
  // Zonder eigen gifs vraagt de mail de lijst op Pages; de nep-fetch geeft daar 204 zonder JSON.
  await createGraphMail(cfg, fetch).verstuur(metPlek)
  assertEquals(calls.some((c) => c.url.endsWith('/mail-gifs/gifs.json')), true)
  assertEquals(body('/messages').body.content, '<p>Hallo</p>\n')
})
