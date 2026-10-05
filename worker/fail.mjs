#!/usr/bin/env node
/**
 * Markeert de extractie als mislukt en laat het Marketing weten in Asana.
 *   node worker/fail.mjs --aanvraag-id <uuid> --reason "site blokkeert headless browsers"
 */
import { addComment } from './lib/asana.mjs'
import { log, parseArgs, UUID_RE } from './lib/config.mjs'
import { renderFailureComment } from './lib/notes.mjs'
import { getAanvraag, updateAanvraag } from './lib/supabase.mjs'

const args = parseArgs()
const id = args['aanvraag-id']
const reason = String(args.reason ?? 'onbekende fout').slice(0, 500)
if (!id || !UUID_RE.test(id)) {
  console.error('Geef --aanvraag-id <uuid>.')
  process.exit(2)
}
const aanvraag = await getAanvraag(id)
await updateAanvraag(id, { brand_status: 'failed', brand_error: reason })
if (aanvraag.asana_task_gid) {
  try {
    await addComment(aanvraag.asana_task_gid, renderFailureComment({ website: aanvraag.website, reason }))
    log('Asana-comment geplaatst')
  } catch (e) {
    log('Asana-comment mislukt', { error: e.message })
  }
  // De knop op Mislukt, zodat hij niet op Bezig blijft staan en Marketing hem opnieuw
  // kan proberen zodra de oorzaak weg is.
  const { zetKnop } = await import('./lib/asana-knop.mjs')
  await zetKnop(aanvraag.asana_task_gid, 'huisstijl', 'mislukt')
}
console.log(`Aanvraag ${id} gemarkeerd als mislukt: ${reason}`)
