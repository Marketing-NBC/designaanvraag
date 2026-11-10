#!/usr/bin/env node
/**
 * Ruimt Verzonden items van het afzenderpostvak op: elke mail van de app gaat als concept en laat
 * na het versturen een kopie achter (zie shared/mail.ts). Die blijven VERZONDEN_BEWAREN_DAGEN dagen
 * staan, zodat je kunt terugkijken wat er de deur uit ging; daarna gaan ze definitief weg. Draait
 * elke werkdag mee in .github/workflows/herinneringen.yml.
 *
 *   MS_TENANT_ID=... MS_CLIENT_ID=... MS_CLIENT_SECRET=... \
 *     node --experimental-strip-types scripts/verzonden-opruimen.mjs [--proef]
 *
 * Met --proef wordt er niets verwijderd.
 */
import { appendFileSync } from 'node:fs'
import { MELDING_AFZENDER } from '../shared/contact.ts'
import { VERZONDEN_BEWAREN_DAGEN, createGraphMail } from '../shared/mail.ts'

const proef = process.argv.includes('--proef')
const zeg = (s) => {
  console.log(s)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${s}\n`)
}

const ms = { tenantId: process.env.MS_TENANT_ID, clientId: process.env.MS_CLIENT_ID, clientSecret: process.env.MS_CLIENT_SECRET }
if (!ms.tenantId || !ms.clientId || !ms.clientSecret) {
  console.error('Fout: MS_TENANT_ID, MS_CLIENT_ID en MS_CLIENT_SECRET zijn nodig.')
  process.exit(1)
}
if (proef) {
  zeg('Proef: Verzonden items niet opgeruimd.')
  process.exit(0)
}

const ouderDan = new Date(Date.now() - VERZONDEN_BEWAREN_DAGEN * 24 * 60 * 60_000)
try {
  const weg = await createGraphMail({ ...ms, afzender: process.env.MAIL_AFZENDER || MELDING_AFZENDER }).ruimVerzondenOp(ouderDan)
  zeg(`Verzonden items: ${weg} mail(s) van meer dan ${VERZONDEN_BEWAREN_DAGEN} dagen geleden verwijderd.`)
} catch (e) {
  zeg(`❌ Verzonden items opruimen mislukt: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
