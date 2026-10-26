import { assertEquals, assertMatch, assertRejects } from 'jsr:@std/assert@1'
import { createGraphMail } from './shared/mail.ts'

const cfg = { tenantId: 'tenant-1', clientId: 'app-1', clientSecret: 'geheim', afzender: 'designaanvraag@nbcevents.nl' }

/** Nep-Microsoft: geeft per URL een antwoord en onthoudt wat er binnenkwam. */
function fakeFetch(antwoorden: { token?: Response | (() => Response); send?: () => Response } = {}) {
  const calls: { url: string; init: RequestInit }[] = []
  const f = (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input)
    calls.push({ url, init })
    if (url.includes('login.microsoftonline.com')) {
      const t = antwoorden.token
      return Promise.resolve(typeof t === 'function' ? t() : t ?? Response.json({ access_token: 'tok-1', expires_in: 3600 }))
    }
    return Promise.resolve(antwoorden.send?.() ?? new Response(null, { status: 202 }))
  }
  return { calls, fetch: f as typeof fetch }
}

const bericht = { aan: ['marketing@nbcevents.nl'], onderwerp: 'Test', html: '<p>Hallo</p>' }

Deno.test('mail gaat via Graph namens de afzender, met een token van de eigen tenant', async () => {
  const { calls, fetch } = fakeFetch()
  await createGraphMail(cfg, fetch).verstuur(bericht)

  assertEquals(calls[0].url, 'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token')
  const form = new URLSearchParams(String(calls[0].init.body))
  assertEquals(form.get('grant_type'), 'client_credentials')
  assertEquals(form.get('scope'), 'https://graph.microsoft.com/.default')

  assertEquals(calls[1].url, 'https://graph.microsoft.com/v1.0/users/designaanvraag%40nbcevents.nl/sendMail')
  assertEquals((calls[1].init.headers as Record<string, string>).Authorization, 'Bearer tok-1')
  const body = JSON.parse(String(calls[1].init.body))
  assertEquals(body.message.subject, 'Test')
  assertEquals(body.message.body, { contentType: 'HTML', content: '<p>Hallo</p>' })
  assertEquals(body.message.toRecipients, [{ emailAddress: { address: 'marketing@nbcevents.nl' } }])
  assertEquals(body.saveToSentItems, false)
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
    token: Response.json({ error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.\r\nTrace ID: x' }, { status: 401 }),
  })
  const e = await assertRejects(() => createGraphMail(cfg, fetch).verstuur(bericht))
  assertMatch((e as Error).message, /Inloggen bij Microsoft mislukt \(401: AADSTS7000215: Invalid client secret provided\.\s*\)/)
})

Deno.test('een weigering van Graph komt met code en uitleg terug', async () => {
  const { fetch } = fakeFetch({
    send: () => Response.json({ error: { code: 'ErrorAccessDenied', message: 'Access is denied.' } }, { status: 403 }),
  })
  const e = await assertRejects(() => createGraphMail(cfg, fetch).verstuur(bericht))
  assertEquals((e as Error).message, 'Mail versturen mislukt (403: ErrorAccessDenied: Access is denied.)')
})

Deno.test('na een 401 wordt er de volgende keer een nieuw token gehaald', async () => {
  let n = 0
  const { calls, fetch } = fakeFetch({ send: () => (n++ === 0 ? new Response('{}', { status: 401 }) : new Response(null, { status: 202 })) })
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
