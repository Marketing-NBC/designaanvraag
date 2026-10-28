import type { AsanaFieldsConfig, AsanaTask, AsanaTaskClient } from '../_shared/asana.ts'
import type { Db, OpleveringRow } from '../_shared/db.ts'
import { MELDING_ONTVANGERS } from '../_shared/shared/contact.ts'
import type { MailBijlage, MailClient } from '../_shared/shared/mail.ts'
import {
  bijlagenBijReactie, laatsteOpleveringReactie, leesOntvangers, reactieAlsMailHtml, renderOpleveringMail, teGrootMelding,
  uniekeAdressen, verslagMislukt, verslagVerstuurd,
} from '../_shared/shared/oplevering.ts'
import { vandaagInNl } from '../_shared/shared/spoed.ts'

/**
 * De knop "Verstuur nu" in het veld Oplevermail: de aanvrager een mail sturen dat het ontwerp klaar is.
 *
 * De mail is de nieuwste reactie die met "Oplevering:" begint, met de bestanden die daarbij in
 * Asana zijn gezet. Hij gaat naar de aanvrager (het adres staat bij de collega in Supabase) en naar
 * de adressen in het veld "Ook mailen naar". Lukt het, dan komt er een verslag als reactie, gaat het
 * veld op Verstuurd en de taak naar Klaar. Lukt het niet, dan wordt er niets half verstuurd: het
 * veld gaat op Mislukt en de reden staat in een reactie.
 */

export interface OpleverDeps {
  asana: AsanaTaskClient
  db: Pick<Db, 'findDetailByAsanaTaskGid' | 'collegaEmail' | 'findOplevering' | 'aantalVerstuurd' | 'insertOplevering' | 'updateOplevering'>
  /** Null als Microsoft 365 niet is ingesteld; dan zegt de reactie dat. */
  mail: MailClient | null
  cfg: AsanaFieldsConfig
  now?: () => Date
  log?: (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void
}

/** Zolang een poging "bezig" is, start een tweede druk op de knop er geen tweede naast. */
const BEZIG_GELDIG_MS = 10 * 60_000

/** Een fout die als reden in Asana komt te staan. Andere fouten zijn onverwacht en krijgen een algemene zin. */
class Weigering extends Error {}

export function createOplever(deps: OpleverDeps): (taak: AsanaTask) => Promise<string> {
  const { asana, db, cfg } = deps
  const now = deps.now ?? (() => new Date())
  const log = deps.log ?? ((level, msg, extra) => console[level === 'info' ? 'log' : level](msg, extra ?? ''))
  const veld = cfg.fields?.oplevermail

  async function zetVeld(taakGid: string, optie: 'verstuurd' | 'mislukt'): Promise<void> {
    const gid = veld?.options?.[optie]
    if (!veld?.gid || !gid) return
    try {
      await asana.updateCustomFields(taakGid, { [veld.gid]: gid })
    } catch (e) {
      log('warn', `oplevermail-veld op ${optie} zetten mislukt`, { gid: taakGid, error: e instanceof Error ? e.message : String(e) })
    }
  }

  async function mislukt(taak: AsanaTask, reden: string, vermeld: string | null, rij: OpleveringRow | null): Promise<string> {
    if (rij) {
      await db.updateOplevering(rij.id, { status: 'mislukt', fout: reden }).catch((e) => {
        log('warn', 'oplevering op mislukt zetten mislukt', { id: rij.id, error: e instanceof Error ? e.message : String(e) })
      })
    }
    try {
      await asana.addComment(taak.gid, verslagMislukt(reden, vermeld ?? taak.assignee))
    } catch (e) {
      log('error', 'reactie bij mislukte oplevering plaatsen mislukt', { gid: taak.gid, error: e instanceof Error ? e.message : String(e) })
    }
    await zetVeld(taak.gid, 'mislukt')
    return `oplevermail niet verstuurd: ${reden}`
  }

  return async (taak) => {
    let rij: OpleveringRow | null = null
    let vermeld: string | null = null
    try {
      if (!deps.mail) throw new Weigering('Het mailen is nog niet ingesteld (zie "Mail instellen" in de README).')

      const aanvraag = await db.findDetailByAsanaTaskGid(taak.gid)
      if (!aanvraag) {
        throw new Weigering('Deze taak hoort niet bij een aanvraag uit het formulier, dus er is geen aanvrager en geen feedbackknop om naar te verwijzen.')
      }

      const reactie = laatsteOpleveringReactie(await asana.listReacties(taak.gid))
      if (!reactie) {
        throw new Weigering('Er staat nog geen reactie die begint met "Oplevering:". Schrijf daarin wat je wil zeggen, zet de bestanden erbij, en druk dan op de knop.')
      }
      vermeld = reactie.auteurGid

      const bestaand = await db.findOplevering(reactie.gid)
      if (bestaand?.status === 'verstuurd') {
        throw new Weigering(`Deze reactie is al verstuurd${bestaand.versie > 1 ? ` als versie ${bestaand.versie}` : ''}. Voor een nieuwe oplevering plaats je een nieuwe reactie "Oplevering:".`)
      }
      if (bestaand?.status === 'bezig' && now().getTime() - Date.parse(bestaand.created_at) < BEZIG_GELDIG_MS) {
        // Twee keer op de knop gedrukt, of Asana stuurde de wijziging dubbel. De eerste loopt nog.
        return 'oplevermail al bezig'
      }

      // Ontvangers: de aanvrager en wie er in "Ook mailen naar" staat.
      const ookVeld = cfg.fields?.ook_mailen_naar?.gid
      const { geldig, ongeldig } = leesOntvangers(ookVeld ? taak.customFields[ookVeld]?.tekst : null)
      if (ongeldig.length) {
        throw new Weigering(`In "Ook mailen naar" staat iets wat geen e-mailadres is: ${ongeldig.join(', ')}. Scheid adressen met een komma.`)
      }
      const aanvrager = await db.collegaEmail(aanvraag.naam)
      const aan = uniekeAdressen([...(aanvrager ? [aanvrager] : []), ...geldig])
      if (!aan.length) {
        throw new Weigering(`Er is geen ontvanger: bij ${aanvraag.naam} staat geen e-mailadres in Supabase (tabel collegas), en "Ook mailen naar" is leeg. Vul daar een adres in.`)
      }

      const keuze = bijlagenBijReactie(await asana.listBestanden(taak.gid), reactie)
      const teGroot = teGrootMelding(keuze)
      if (teGroot) throw new Weigering(teGroot)

      const versie = (await db.aantalVerstuurd(aanvraag.id)) + 1
      const bijlagenAdmin = keuze.bestanden.map((b) => ({ naam: b.naam, bytes: b.bytes ?? 0 }))
      if (bestaand) {
        // Een eerdere poging met deze reactie mislukte (of bleef hangen): dezelfde rij opnieuw.
        rij = { ...bestaand, versie, ontvangers: aan, bijlagen: bijlagenAdmin, status: 'bezig', fout: null }
        await db.updateOplevering(bestaand.id, { versie, ontvangers: aan, bijlagen: bijlagenAdmin, status: 'bezig', fout: null, created_at: now().toISOString() })
      } else {
        rij = await db.insertOplevering({ aanvraag_id: aanvraag.id, comment_gid: reactie.gid, versie, ontvangers: aan, bijlagen: bijlagenAdmin })
      }

      const bijlagen: MailBijlage[] = []
      for (const b of keuze.bestanden) {
        const { bytes, mime } = await asana.downloadBestand(b.gid)
        bijlagen.push({ naam: b.naam, mime, bytes })
      }
      // De grootte uit Asana is een opgave; wat we echt binnenkregen telt.
      const echtTeGroot = teGrootMelding({ ...keuze, totaalBytes: bijlagen.reduce((n, b) => n + b.bytes.length, 0) })
      if (echtTeGroot) throw new Weigering(echtTeGroot)

      const bericht = renderOpleveringMail({
        aan,
        antwoordAan: [MELDING_ONTVANGERS[aanvraag.locatie] ?? MELDING_ONTVANGERS.nbc],
        aanvraagId: aanvraag.id,
        versie,
        soort: aanvraag.soort,
        event: aanvraag.event,
        eventDatum: aanvraag.event_datum,
        omschrijving: aanvraag.omschrijving,
        types: aanvraag.aanvraag_types ?? [],
        andersTekst: aanvraag.anders_tekst,
        berichtHtml: reactieAlsMailHtml(reactie.html || reactie.tekst),
        afzenderNaam: reactie.auteurNaam,
        bijlagen: bijlagen.map((b) => ({ naam: b.naam, bytes: b.bytes.length })),
        links: keuze.links.map((l) => ({ naam: l.naam, url: l.viewUrl ?? '' })),
      })
      try {
        await deps.mail.verstuur({ ...bericht, bijlagen })
      } catch (e) {
        throw new Weigering(`Microsoft weigerde de mail: ${e instanceof Error ? e.message : String(e)}`)
      }

      const moment = now()
      await db.updateOplevering(rij.id, { status: 'verstuurd', fout: null, verstuurd_op: moment.toISOString() })
      log('info', 'opleveringsmail verstuurd', { gid: taak.gid, aanvraag: aanvraag.id, versie, ontvangers: aan.length, bijlagen: bijlagen.length })

      // Vanaf hier is de mail de deur uit. Wat nog misgaat is administratie, en mag geen "Mislukt" opleveren.
      try {
        await asana.addComment(taak.gid, verslagVerstuurd({
          versie,
          aan,
          bijlagen: bijlagen.map((b) => b.naam),
          links: keuze.links.map((l) => l.naam),
          datum: vandaagInNl(moment),
        }))
      } catch (e) {
        log('warn', 'verslag van oplevering plaatsen mislukt', { gid: taak.gid, error: e instanceof Error ? e.message : String(e) })
      }
      await zetVeld(taak.gid, 'verstuurd')
      try {
        await asana.rondAf(taak.gid, cfg.sections?.klaar?.gid ?? null)
      } catch (e) {
        log('warn', 'taak afronden na oplevering mislukt', { gid: taak.gid, error: e instanceof Error ? e.message : String(e) })
      }
      return `oplevermail verstuurd (versie ${versie})`
    } catch (e) {
      if (e instanceof Weigering) return mislukt(taak, e.message, vermeld, rij)
      const msg = e instanceof Error ? e.message : String(e)
      log('error', 'oplevermail mislukt', { gid: taak.gid, error: msg })
      return mislukt(taak, `Er ging iets mis aan onze kant (${msg}).`, vermeld, rij)
    }
  }
}
