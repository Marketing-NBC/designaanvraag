import type { AsanaFieldsConfig, AsanaTask, AsanaTaskClient } from '../_shared/asana.ts'
import type { Db, OpleveringRow } from '../_shared/db.ts'
import { MELDING_ONTVANGERS } from '../_shared/shared/contact.ts'
import { themaVoor } from '../_shared/shared/mail.ts'
import type { MailBijlage, MailClient } from '../_shared/shared/mail.ts'
import {
  OPLEVER_SUBTAAK, beschrijvingAlsMailHtml, leesOntvangers, openOpleverSubtaak, renderOpleveringMail, teGrootMelding, uniekeAdressen,
  verdeelBijlagen, verslagMislukt, verslagProef, verslagVerstuurd, verstuurdeSubtaakNaam,
} from '../_shared/shared/oplevering.ts'
import { vandaagInNl } from '../_shared/shared/spoed.ts'

/**
 * Het veld Oplevermail: de aanvrager een mail sturen dat het ontwerp klaar is.
 *
 * De mail komt uit de subtaak "Oplevering": de beschrijving is de tekst, de bijlagen zijn de
 * bestanden. Wat Marketing in die subtaak ziet, is wat er verstuurd wordt. De mail gaat naar de
 * aanvrager (het adres staat bij de collega in Supabase) en naar de adressen in het veld "Ook
 * mailen naar".
 *
 * "Stuur proef naar mij" stuurt precies dezelfde mail alleen naar wie op de knop drukte. Er wordt
 * dan niets afgevinkt of geteld.
 *
 * "Verstuur nu" verstuurt hem echt. Daarna een verslag als reactie, het veld op Verstuurd, de
 * subtaak afgevinkt en hernoemd naar zijn versie, een nieuwe lege subtaak Oplevering voor een
 * volgende versie, en de taak naar Klaar. Lukt het niet, dan wordt er niets half verstuurd: het
 * veld gaat op Mislukt en de reden staat in een reactie.
 */

export interface OpleverDeps {
  asana: AsanaTaskClient
  db: Pick<Db, 'findDetailByAsanaTaskGid' | 'collegaEmail' | 'findOplevering' | 'aantalVerstuurd' | 'insertOplevering' | 'heropenOplevering' | 'updateOplevering'>
  /** Null als Microsoft 365 niet is ingesteld; dan zegt de reactie dat. */
  mail: MailClient | null
  cfg: AsanaFieldsConfig
  now?: () => Date
  log?: (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void
}

export interface OpleverOpties {
  /** Alleen een proefmail naar wie op de knop drukte. */
  proef: boolean
  /** De Asana-gebruiker die het veld omzette, als Asana dat meegaf. */
  door: string | null
}

/** Zolang een poging "bezig" is, start een tweede druk op de knop er geen tweede naast. */
const BEZIG_GELDIG_MS = 10 * 60_000

/** Een fout die als reden in Asana komt te staan. Andere fouten zijn onverwacht en krijgen een algemene zin. */
class Weigering extends Error {}

export function createOplever(deps: OpleverDeps): (taak: AsanaTask, opties: OpleverOpties) => Promise<string> {
  const { asana, db, cfg } = deps
  const now = deps.now ?? (() => new Date())
  const log = deps.log ?? ((level, msg, extra) => console[level === 'info' ? 'log' : level](msg, extra ?? ''))
  const veld = cfg.fields?.oplevermail

  const fout = (e: unknown) => (e instanceof Error ? e.message : String(e))

  async function zetVeld(taakGid: string, optie: 'verstuurd' | 'proef_verstuurd' | 'mislukt'): Promise<void> {
    const gid = veld?.options?.[optie]
    if (!veld?.gid || !gid) return
    try {
      await asana.updateCustomFields(taakGid, { [veld.gid]: gid })
    } catch (e) {
      log('warn', `oplevermail-veld op ${optie} zetten mislukt`, { gid: taakGid, error: fout(e) })
    }
  }

  async function mislukt(taak: AsanaTask, reden: string, opties: OpleverOpties, rij: OpleveringRow | null): Promise<string> {
    if (rij) {
      await db.updateOplevering(rij.id, { status: 'mislukt', fout: reden }).catch((e) => {
        log('warn', 'oplevering op mislukt zetten mislukt', { id: rij.id, error: fout(e) })
      })
    }
    try {
      await asana.addComment(taak.gid, verslagMislukt(reden, opties.door ?? taak.assignee, opties.proef))
    } catch (e) {
      log('error', 'reactie bij mislukte oplevering plaatsen mislukt', { gid: taak.gid, error: fout(e) })
    }
    await zetVeld(taak.gid, 'mislukt')
    return `${opties.proef ? 'proefmail' : 'oplevermail'} niet verstuurd: ${reden}`
  }

  return async (taak, { proef, door }) => {
    let rij: OpleveringRow | null = null
    try {
      if (!deps.mail) throw new Weigering('Het mailen is nog niet ingesteld (zie "Mail instellen" in de README).')

      const aanvraag = await db.findDetailByAsanaTaskGid(taak.gid)
      if (!aanvraag) {
        throw new Weigering('Deze taak hoort niet bij een aanvraag uit het formulier, dus er is geen aanvrager en geen feedbackknop om naar te verwijzen.')
      }

      const subtaak = openOpleverSubtaak(await asana.listSubtaken(taak.gid))
      if (!subtaak) {
        // Een taak van voor deze functie, of de vorige versie is net verstuurd en de nieuwe lege
        // subtaak is weggegooid. Dan maken we hem, zodat je meteen ziet waar het moet.
        await asana.maakSubtaak(taak.gid, OPLEVER_SUBTAAK, taak.assignee)
        throw new Weigering('Er stond geen open subtaak "Oplevering"; die staat er nu. Zet daar de tekst voor de aanvrager in de beschrijving en de bestanden als bijlage.')
      }

      const versie = (await db.aantalVerstuurd(aanvraag.id)) + 1

      if (!proef) {
        const bestaand = await db.findOplevering(subtaak.gid)
        if (bestaand?.status === 'verstuurd') {
          throw new Weigering(`Deze subtaak Oplevering is al verstuurd als versie ${bestaand.versie}. Vink hem af en maak een nieuwe subtaak "Oplevering" voor de volgende versie.`)
        }
        if (bestaand?.status === 'bezig' && now().getTime() - Date.parse(bestaand.created_at) < BEZIG_GELDIG_MS) {
          // Twee keer op de knop gedrukt, of Asana stuurde de wijziging dubbel. De eerste loopt nog.
          return 'oplevermail al bezig'
        }
        // Meteen de rij claimen, vóór het trage werk. Stuurt Asana de wijziging dubbel, dan zien beide
        // aanroepen hierboven nog niets; de tweede verliest dan hier en doet verder niets, ook geen
        // reactie of Mislukt, want de eerste verstuurt hem.
        const claim = { versie, status: 'bezig' as const, fout: null, created_at: now().toISOString() }
        if (bestaand) {
          // Een eerdere poging met deze subtaak mislukte (of bleef hangen): dezelfde rij opnieuw.
          if (!(await db.heropenOplevering(bestaand, claim))) return 'oplevermail al bezig'
          rij = { ...bestaand, ...claim }
        } else {
          rij = await db.insertOplevering({ aanvraag_id: aanvraag.id, subtaak_gid: subtaak.gid, versie, ontvangers: [], bijlagen: [] })
          if (!rij) return 'oplevermail al bezig'
        }
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

      const keuze = verdeelBijlagen(await asana.listBestanden(subtaak.gid))
      const berichtHtml = beschrijvingAlsMailHtml(subtaak.html, themaVoor(aanvraag.locatie))
      if (!berichtHtml && !keuze.bestanden.length && !keuze.links.length) {
        throw new Weigering('De subtaak Oplevering is nog leeg. Zet de tekst voor de aanvrager in de beschrijving en de bestanden als bijlage.')
      }
      const teGroot = teGrootMelding(keuze)
      if (teGroot) throw new Weigering(teGroot)

      // Wie drukte: diens naam staat onder het bericht, en een proef gaat naar diens adres.
      let wie: { naam: string | null; email: string | null } = { naam: null, email: null }
      if (door) {
        try {
          wie = await asana.gebruiker(door)
        } catch (e) {
          log('warn', 'gebruiker ophalen mislukt', { door, error: fout(e) })
        }
      }
      const marketing = MELDING_ONTVANGERS[aanvraag.locatie] ?? MELDING_ONTVANGERS.nbc

      if (rij) {
        await db.updateOplevering(rij.id, { ontvangers: aan, bijlagen: keuze.bestanden.map((b) => ({ naam: b.naam, bytes: b.bytes ?? 0 })) })
      }

      const bijlagen: MailBijlage[] = []
      for (const b of keuze.bestanden) {
        const { bytes, mime } = await asana.downloadBestand(b.gid)
        bijlagen.push({ naam: b.naam, mime, bytes })
      }
      // De grootte uit Asana is een opgave; wat we echt binnenkregen telt.
      const echtTeGroot = teGrootMelding({ ...keuze, totaalBytes: bijlagen.reduce((n, b) => n + b.bytes.length, 0) })
      if (echtTeGroot) throw new Weigering(echtTeGroot)

      // Een proef gaat naar wie drukte. Weten we dat niet, dan naar het marketingpostvak: dan kijkt
      // in elk geval iemand van het team mee voordat het echt de deur uit gaat.
      const proefNaar = wie.email ?? marketing
      const bericht = renderOpleveringMail({
        aan: proef ? [proefNaar] : aan,
        antwoordAan: [marketing],
        aanvraagId: aanvraag.id,
        versie,
        locatie: aanvraag.locatie,
        soort: aanvraag.soort,
        event: aanvraag.event,
        eventDatum: aanvraag.event_datum,
        omschrijving: aanvraag.omschrijving,
        types: aanvraag.aanvraag_types ?? [],
        andersTekst: aanvraag.anders_tekst,
        berichtHtml,
        afzenderNaam: wie.naam,
        bijlagen: bijlagen.map((b) => ({ naam: b.naam, bytes: b.bytes.length })),
        links: keuze.links.map((l) => ({ naam: l.naam, url: l.viewUrl ?? '' })),
        proef: proef ? { echteOntvangers: aan } : null,
      })
      try {
        await deps.mail.verstuur({ ...bericht, bijlagen })
      } catch (e) {
        throw new Weigering(`Microsoft weigerde de ${proef ? 'proefmail' : 'mail'}: ${fout(e)}`)
      }

      const linkNamen = keuze.links.map((l) => l.naam)
      if (proef) {
        log('info', 'proefmail oplevering verstuurd', { gid: taak.gid, aanvraag: aanvraag.id, naar: proefNaar })
        try {
          await asana.addComment(taak.gid, verslagProef({ naar: proefNaar, aan, bijlagen: bijlagen.map((b) => b.naam), links: linkNamen }))
        } catch (e) {
          log('warn', 'verslag van proefmail plaatsen mislukt', { gid: taak.gid, error: fout(e) })
        }
        await zetVeld(taak.gid, 'proef_verstuurd')
        return 'proefmail verstuurd'
      }

      const moment = now()
      const datum = vandaagInNl(moment)
      await db.updateOplevering(rij!.id, { status: 'verstuurd', fout: null, verstuurd_op: moment.toISOString() })
      log('info', 'opleveringsmail verstuurd', { gid: taak.gid, aanvraag: aanvraag.id, versie, ontvangers: aan.length, bijlagen: bijlagen.length })

      // Vanaf hier is de mail de deur uit. Wat nog misgaat is administratie, en mag geen "Mislukt" opleveren.
      const nazorg = async (wat: string, stap: () => Promise<unknown>) => {
        try {
          await stap()
        } catch (e) {
          log('warn', `${wat} na oplevering mislukt`, { gid: taak.gid, error: fout(e) })
        }
      }
      await nazorg('verslag plaatsen', () => asana.addComment(taak.gid, verslagVerstuurd({ versie, aan, bijlagen: bijlagen.map((b) => b.naam), links: linkNamen, datum })))
      await zetVeld(taak.gid, 'verstuurd')
      await nazorg('subtaak afvinken', () => asana.werkTaakBij(subtaak.gid, { naam: verstuurdeSubtaakNaam(versie, datum), completed: true }))
      await nazorg('nieuwe subtaak maken', () => asana.maakSubtaak(taak.gid, OPLEVER_SUBTAAK, taak.assignee))
      await nazorg('taak afronden', () => asana.rondAf(taak.gid, cfg.sections?.klaar?.gid ?? null))
      return `oplevermail verstuurd (versie ${versie})`
    } catch (e) {
      if (e instanceof Weigering) return mislukt(taak, e.message, { proef, door }, rij)
      log('error', 'oplevermail mislukt', { gid: taak.gid, error: fout(e) })
      return mislukt(taak, `Er ging iets mis aan onze kant (${fout(e)}).`, { proef, door }, rij)
    }
  }
}
