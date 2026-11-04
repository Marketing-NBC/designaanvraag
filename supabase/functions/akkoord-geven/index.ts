import { createAsanaTaskClient } from '../_shared/asana.ts'
import { createDb } from '../_shared/db.ts'
import { mailClientUit, readEnv } from '../_shared/env.ts'
import { createHandler } from './handler.ts'

const env = readEnv()

const handler = createHandler({
  env,
  db: createDb(env.supabaseUrl, env.supabaseSecretKey),
  // Zonder PAT staat het akkoord toch vast; Marketing hoort in de mail dat Asana niet bijgewerkt is.
  asana: env.asanaPat ? createAsanaTaskClient(env.asanaPat) : null,
  mail: mailClientUit(env),
})

Deno.serve(async (req) => {
  try {
    return await handler(req)
  } catch (e) {
    console.error('akkoord-geven: onverwachte fout', e)
    return new Response(JSON.stringify({ error: 'Er ging iets mis aan onze kant. Probeer het zo opnieuw.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': env.allowedOrigins[0] ?? '' },
    })
  }
})
