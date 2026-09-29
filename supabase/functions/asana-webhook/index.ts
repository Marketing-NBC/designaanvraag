import { asanaFields, createAsanaTaskClient } from '../_shared/asana.ts'
import { createDb, createWebhookStore } from '../_shared/db.ts'
import { readEnv, webhookToken } from '../_shared/env.ts'
import { createRoutineClient } from '../_shared/routine.ts'
import { createHandler } from './handler.ts'

const env = readEnv()
if (!env.asanaPat) throw new Error('ASANA_PAT is verplicht voor asana-webhook')

const db = createDb(env.supabaseUrl, env.supabaseSecretKey)
const menuRoutine = env.menuRoutineFireUrl && env.menuRoutineToken
  ? createRoutineClient(env.menuRoutineFireUrl, env.menuRoutineToken)
  : null

/**
 * De knop "Genereer nu" in Asana. We zoeken de aanvraag bij de taak, zetten hem
 * terug op `pending` (een tweede ronde moet gewoon mogen) en starten de Routine
 * die het scherm maakt. Zonder ingestelde Routine gebeurt er niets en zegt de
 * webhook dat; stil laten lopen zou betekenen dat iemand zit te wachten op een
 * scherm dat nooit komt.
 */
async function startMenu(asanaTaskGid: string, kleuren: 'nbc' | 'opdrachtgever'): Promise<boolean> {
  const aanvraag = await db.findByAsanaTaskGid(asanaTaskGid)
  if (!aanvraag || !menuRoutine) return false
  await db.update(aanvraag.id, { menu_status: 'pending', menu_error: null, menu_kleuren: kleuren })
  const { sessionUrl } = await menuRoutine.fire(`aanvraag_id=${aanvraag.id}`)
  console.log('menu-routine gestart', JSON.stringify({ id: aanvraag.id, kleuren, sessionUrl }))
  return true
}

const handler = createHandler({
  token: await webhookToken(env.asanaPat),
  store: createWebhookStore(env.supabaseUrl, env.supabaseSecretKey),
  markeerVervallen: (gid, moment) => db.markeerVervallen(gid, moment),
  startMenu: menuRoutine ? startMenu : undefined,
  asana: createAsanaTaskClient(env.asanaPat),
  cfg: asanaFields,
  planningProjectGid: env.asanaPlanningProjectGid,
})

Deno.serve(async (req) => {
  try {
    return await handler(req)
  } catch (e) {
    console.error('asana-webhook: onverwachte fout', e)
    return new Response(JSON.stringify({ error: 'Er ging iets mis' }), { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } })
  }
})
