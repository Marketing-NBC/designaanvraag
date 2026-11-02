import { asanaFields, createAsanaTaskClient } from '../_shared/asana.ts'
import { createDb, createWebhookStore } from '../_shared/db.ts'
import { mailClientUit, readEnv, webhookToken } from '../_shared/env.ts'
import { createPreviewBouwer } from '../_shared/github.ts'
import { createRoutineClient } from '../_shared/routine.ts'
import { createHandler } from './handler.ts'
import { createOplever } from './oplevering.ts'

const env = readEnv()
if (!env.asanaPat) throw new Error('ASANA_PAT is verplicht voor asana-webhook')

const db = createDb(env.supabaseUrl, env.supabaseSecretKey)
const menuRoutine = env.menuRoutineFireUrl && env.menuRoutineToken
  ? createRoutineClient(env.menuRoutineFireUrl, env.menuRoutineToken)
  : null
// Dezelfde Routine die bij het indienen van een aanvraag draait; opnieuw ophalen is
// precies hetzelfde draaiboek, alleen op een ander moment gestart.
const brandRoutine = env.routineFireUrl && env.routineToken
  ? createRoutineClient(env.routineFireUrl, env.routineToken)
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

/**
 * De knop "Haal opnieuw op". Mislukte de huisstijl de eerste keer, dan stond de
 * aanvraag op `failed` en kon Marketing daar niets mee; nu zetten we hem terug op
 * `running` en start dezelfde Routine opnieuw. De oude foutmelding gaat weg, anders
 * blijft die staan bij een poging die misschien wel lukt.
 */
async function startHuisstijl(asanaTaskGid: string): Promise<boolean> {
  const aanvraag = await db.findByAsanaTaskGid(asanaTaskGid)
  if (!aanvraag || !brandRoutine) return false
  const { sessionUrl } = await brandRoutine.fire(`aanvraag_id=${aanvraag.id}`)
  await db.update(aanvraag.id, { brand_status: 'running', brand_error: null, brand_session_url: sessionUrl })
  console.log('huisstijl-routine opnieuw gestart', JSON.stringify({ id: aanvraag.id, sessionUrl }))
  return true
}

const asana = createAsanaTaskClient(env.asanaPat)
const oplever = createOplever({
  asana, db, mail: mailClientUit(env), cfg: asanaFields,
  previewBouwer: env.ledkolomGithubToken ? createPreviewBouwer(env.ledkolomGithubToken) : null,
})

declare const EdgeRuntime: { waitUntil(werk: Promise<unknown>): void } | undefined

const handler = createHandler({
  token: await webhookToken(env.asanaPat),
  store: createWebhookStore(env.supabaseUrl, env.supabaseSecretKey),
  markeerVervallen: (gid, moment) => db.markeerVervallen(gid, moment),
  deadlineVan: (gid) => db.deadlineVan(gid),
  startMenu: menuRoutine ? startMenu : undefined,
  startHuisstijl: brandRoutine ? startHuisstijl : undefined,
  oplever,
  // Supabase laat de function doorlopen tot dit klaar is, ook nadat Asana zijn antwoord heeft.
  achtergrond: typeof EdgeRuntime !== 'undefined' ? (werk) => EdgeRuntime!.waitUntil(werk) : undefined,
  asana,
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
