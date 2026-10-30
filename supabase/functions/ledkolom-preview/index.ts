import { createAsanaTaskClient, asanaFields } from '../_shared/asana.ts'
import { createDb } from '../_shared/db.ts'
import { mailClientUit, readEnv } from '../_shared/env.ts'
import { createPreviewBouwer } from '../_shared/github.ts'
import { createOplever } from '../asana-webhook/oplevering.ts'
import { createHandler } from './handler.ts'

const env = readEnv()
if (!env.asanaPat) throw new Error('ASANA_PAT is verplicht voor ledkolom-preview')
if (!env.ledkolomGeheim) throw new Error('LEDKOLOM_SECRET is verplicht voor ledkolom-preview')

const db = createDb(env.supabaseUrl, env.supabaseSecretKey)
const asana = createAsanaTaskClient(env.asanaPat)
// Dezelfde opleverflow als achter de knop in Asana: een wachtende mail gaat precies zo de deur uit.
const oplever = createOplever({
  asana, db, mail: mailClientUit(env), cfg: asanaFields,
  previewBouwer: env.ledkolomGithubToken ? createPreviewBouwer(env.ledkolomGithubToken) : null,
})

declare const EdgeRuntime: { waitUntil(werk: Promise<unknown>): void } | undefined

const handler = createHandler({
  geheim: env.ledkolomGeheim,
  db,
  asana,
  oplever,
  achtergrond: typeof EdgeRuntime !== 'undefined' ? (werk) => EdgeRuntime!.waitUntil(werk) : undefined,
})

Deno.serve(async (req) => {
  try {
    return await handler(req)
  } catch (e) {
    console.error('ledkolom-preview: onverwachte fout', e)
    return new Response(JSON.stringify({ error: 'Er ging iets mis' }), { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } })
  }
})
