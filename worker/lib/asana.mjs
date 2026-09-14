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
  const res = await fetch(`${API}/tasks/${gid}?opt_fields=gid,name,html_notes,notes,permalink_url`, { headers: headers() })
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

/** Comment op de taak (html_text: alleen tekst, strong/em, a, ul/li; geen img of koppen). */
export async function addComment(taskGid, htmlText) {
  const res = await fetch(`${API}/tasks/${taskGid}/stories`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ data: { html_text: htmlText } }),
  })
  return parse(res, `POST story ${taskGid}`)
}
