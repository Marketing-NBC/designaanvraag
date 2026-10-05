import { requireEnv } from './config.mjs'

const API = 'https://app.asana.com/api/1.0'

function headers(extra = {}) {
  return { Authorization: `Bearer ${requireEnv('ASANA_PAT')}`, Accept: 'application/json', ...extra }
}

async function parse(res, what) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Asana ${what} → ${res.status}: ${body?.errors?.map((e) => e.message).join('; ') ?? 'onbekende fout'}`)
  return body.data
}

export async function getTask(gid) {
  const res = await fetch(`${API}/tasks/${gid}?opt_fields=gid,name,html_notes,notes,permalink_url,custom_fields.gid,custom_fields.name,custom_fields.text_value`, { headers: headers() })
  return parse(res, `GET task ${gid}`)
}

export async function updateTaskHtmlNotes(gid, htmlNotes) {
  const res = await fetch(`${API}/tasks/${gid}`, {
    method: 'PUT',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ data: { html_notes: htmlNotes } }),
  })
  return parse(res, `PUT task ${gid}`)
}

/** Upload een bestand als bijlage. Geeft { gid, name, permalink_url } terug. */
export async function uploadAttachment(taskGid, filename, buffer, contentType) {
  const form = new FormData()
  form.append('parent', taskGid)
  form.append('file', new Blob([buffer], { type: contentType }), filename)
  const res = await fetch(`${API}/attachments`, { method: 'POST', headers: headers(), body: form })
  return parse(res, `POST attachment ${filename}`)
}

/** De subtaken van een taak: { gid, name, completed }. */
export async function getSubtasks(gid) {
  const res = await fetch(`${API}/tasks/${gid}/subtasks?opt_fields=gid,name,completed`,
    { headers: headers() })
  return parse(res, `GET subtasks ${gid}`) ?? []
}

/** De bijlagen van een taak: { gid, name, resource_subtype, created_at }. */
export async function getAttachments(gid) {
  const res = await fetch(
    `${API}/tasks/${gid}/attachments?opt_fields=gid,name,resource_subtype,created_at`,
    { headers: headers() })
  return parse(res, `GET attachments ${gid}`) ?? []
}

/**
 * Haalt een bijlage op als buffer.
 *
 * Asana geeft een tijdelijke download-link terug die zelf al ondertekend is. Die
 * link mag je NIET met de Asana-token ophalen: de opslag erachter weigert een
 * verzoek met een tweede vorm van authenticatie.
 */
export async function downloadAttachment(gid) {
  const res = await fetch(`${API}/attachments/${gid}?opt_fields=gid,name,download_url,size`,
    { headers: headers() })
  const info = await parse(res, `GET attachment ${gid}`)
  if (!info?.download_url) throw new Error(`Bijlage ${gid} heeft geen download-link`)
  const bestand = await fetch(info.download_url)
  if (!bestand.ok) throw new Error(`Bijlage "${info.name}" ophalen mislukte (${bestand.status})`)
  return { ...info, buffer: Buffer.from(await bestand.arrayBuffer()) }
}

/** Comment op de taak (html_text: alleen tekst, strong/em, a, ul/li; geen img of koppen). */
export async function addComment(taskGid, htmlText) {
  const res = await fetch(`${API}/tasks/${taskGid}/stories`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ data: { html_text: htmlText } }),
  })
  return parse(res, `POST story ${taskGid}`)
}

/**
 * Zet custom fields op een taak: { "<veld-gid>": "<optie-gid of waarde>" }.
 * Zo zet de worker de knop "Menuscherm" zelf op Klaar of Mislukt als hij klaar is.
 */
export async function updateCustomFields(gid, waarden) {
  const res = await fetch(`${API}/tasks/${gid}`, {
    method: 'PUT',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ data: { custom_fields: waarden } }),
  })
  return parse(res, `PUT task ${gid} (velden)`)
}
