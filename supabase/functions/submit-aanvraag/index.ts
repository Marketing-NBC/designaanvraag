import { createAsanaClient } from '../_shared/asana.ts'
import { createDb } from '../_shared/db.ts'
import { mailClientUit, readEnv } from '../_shared/env.ts'
import { createStorage } from '../_shared/storage.ts'
import { createRoutineClient } from '../_shared/routine.ts'
import { createHandler } from './handler.ts'

const env = readEnv()

const handler = createHandler({
  env,
  db: createDb(env.supabaseUrl, env.supabaseSecretKey),
  asana: env.asanaPat ? createAsanaClient(env.asanaPat) : null,
  routine: env.routineFireUrl && env.routineToken ? createRoutineClient(env.routineFireUrl, env.routineToken) : null,
  storage: createStorage(env.supabaseUrl, env.supabaseSecretKey),
  mail: mailClientUit(env),
})

Deno.serve(async (req) => {
  try {
    return await handler(req)
  } catch (e) {
    console.error('submit-aanvraag: onverwachte fout', e)
    return new Response(JSON.stringify({ error: 'Er ging iets mis aan onze kant. Probeer het zo opnieuw.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': env.allowedOrigins[0] ?? '' },
    })
  }
})
