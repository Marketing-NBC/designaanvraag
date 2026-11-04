import type { AsanaFieldsConfig, AsanaTask, AsanaTaskClient } from '../_shared/asana.ts'
import type { AanvraagDetail, Db, LedkolomPreviewRow, OpleveringRow } from '../_shared/db.ts'
import type { PreviewBouwer } from '../_shared/github.ts'
import { MELDING_ONTVANGERS } from '../_shared/shared/contact.ts'
import {
  LEDKOLOM_VASTGELOPEN_MIN, isLedkolomAanvraag, previewMisluktReden, previewUrl, verslagWachtOpPreview, vindReleaseLinks, zonderReleaseLinks,
} from '../_shared/shared/ledkolom-preview.ts'
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
 *
 * Bij een LED-kolom staat in de beschrijving van de subtaak een link naar een release in de 3D-repo
 * (de video is te groot voor Asana). Die link gaat niet mee in de mail; de aanvrager krijgt een knop
 * naar de 3D-preview (zie shared/ledkolom-preview.ts). Al bij de proef start het maken daarvan. Staat de preview bij
 * "Verstuur nu" nog niet online, dan wacht de mail: de function ledkolom-preview roept deze functie
 * opnieuw aan (met `naPreview`) zodra de 3D-repo laat weten dat hij klaar is.
 */

export interface OpleverDeps {
  asana: AsanaTaskClient
  db: Pick<Db,
    | 'findDetailByAsanaTaskGid' | 'collegaEmail' | 'findOplevering' | 'aantalVerstuurd' | 'insertOplevering' | 'updateOplevering'
    | 'pakWachtendeOplevering' | 'ledkolomPreviews' | 'insertLedkolomPreview' | 'updateLedkolomPreview' | 'stopHerinneringen'>
  /** Null als Microsoft 365 niet is ingesteld; dan zegt de reactie dat. */
  mail: MailClient | null
  cfg: AsanaFieldsConfig
  /** Start de build van de 3D-previews; null als die koppeling (nog) niet is ingesteld. */
  previewBouwer?: PreviewBouwer | null
  now?: () => Date
  log?: (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void
}

export interface OpleverOpties {
  /** Alleen een proefmail naar wie op de knop drukte. */
  proef: boolean
  /** De Asana-gebruiker die het veld omzette, als Asana dat meegaf. */
  door: string | null
  /**
   * Niet op de knop gedrukt: de 3D-preview waar deze mail op wachtte is klaar (of mislukt). Doet
   * alleen iets als er echt een mail wacht, en start een mislukte preview niet opnieuw.
   */
  naPreview?: boolean
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

  /**
   * Per release-link een rij. Een nieuwe link, een mislukte poging of een run die na een kwartier nog
   * niets liet horen, gaat (opnieuw) op "wacht", en dan starten we de workflow in de 3D-repo. Die haalt
   * zelf op wat er klaarstaat en meldt terug bij de function ledkolom-preview.
   */
  async function previewsKlaarzetten(aanvraag: AanvraagDetail, bronnen: string[], naPreview: boolean): Promise<LedkolomPreviewRow[]> {
    if (!deps.previewBouwer) {
      throw new Weigering('Er staat een link naar een ledkolom-release in de subtaak Oplevering, maar de koppeling met de 3D-preview is nog niet ingesteld '
        + '(zie "3D-preview van de ledkolom" in de README).')
    }
    const bestaand = await db.ledkolomPreviews(aanvraag.id)
    const rijen: LedkolomPreviewRow[] = []
    const gestart: LedkolomPreviewRow[] = []
    const vastgelopen = (r: LedkolomPreviewRow) => now().getTime() - Date.parse(r.gevraagd_op) > LEDKOLOM_VASTGELOPEN_MIN * 60_000

    for (const bron of bronnen) {
      let rij = bestaand.find((r) => r.bron === bron) ?? null
      if (!rij) {
        rij = await db.insertLedkolomPreview({ aanvraag_id: aanvraag.id, bron })
        gestart.push(rij)
      } else if (!naPreview && (rij.status === 'mislukt' || (rij.status === 'wacht' && vastgelopen(rij)))) {
        const opnieuw = { status: 'wacht' as const, fout: null, gevraagd_op: now().toISOString(), klaar_op: null }
        await db.updateLedkolomPreview(rij.id, opnieuw)
        rij = { ...rij, ...opnieuw }
        gestart.push(rij)
      }
      // Alleen na een melding van de 3D-repo kan hier nog een mislukte staan: die starten we niet
      // eindeloos opnieuw, de mail gaat op Mislukt met de reden.
      if (rij.status === 'mislukt') throw new Weigering(previewMisluktReden(rij.bron, rij.fout ?? 'geen reden opgegeven'))
      rijen.push(rij)
    }

    if (gestart.length) {
      try {
        await deps.previewBouwer.start()
        log('info', '3D-preview gestart', { aanvraag: aanvraag.id, bronnen: gestart.map((r) => r.bron) })
      } catch (e) {
        // Op mislukt, zodat de volgende druk op de knop het meteen opnieuw probeert.
        for (const r of gestart) {
          await db.updateLedkolomPreview(r.id, { status: 'mislukt', fout: fout(e) }).catch(() => {})
        }
        throw new Weigering(`De 3D-preview kon niet gestart worden: ${fout(e)}`)
      }
    }
    return rijen
  }

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

  return async (taak, { proef, door, naPreview = false }) => {
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

      if (!proef) {
        const bestaand = await db.findOplevering(subtaak.gid)
        // Een melding van de 3D-repo, maar deze mail wacht nergens (meer) op: niets te doen.
        if (naPreview && bestaand?.status !== 'wacht_op_preview') return 'geen mail die op de 3D-preview wacht'
        if (bestaand?.status === 'verstuurd') {
          throw new Weigering(`Deze subtaak Oplevering is al verstuurd als versie ${bestaand.versie}. Vink hem af en maak een nieuwe subtaak "Oplevering" voor de volgende versie.`)
        }
        if (bestaand?.status === 'bezig' && now().getTime() - Date.parse(bestaand.created_at) < BEZIG_GELDIG_MS) {
          // Twee keer op de knop gedrukt, of Asana stuurde de wijziging dubbel. De eerste loopt nog.
          return 'oplevermail al bezig'
        }
        rij = bestaand
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

      // Bij een LED-kolom wordt een release-link uit de beschrijving een 3D-preview. De link zelf
      // gaat niet mee: de aanvrager krijgt een knop naar de preview, geen pagina op GitHub.
      const bronnen = isLedkolomAanvraag(aanvraag.aanvraag_types) ? vindReleaseLinks(subtaak.html) : []
      const keuze = verdeelBijlagen(await asana.listBestanden(subtaak.gid))
      const berichtHtml = beschrijvingAlsMailHtml(bronnen.length ? zonderReleaseLinks(subtaak.html) : subtaak.html, themaVoor(aanvraag.locatie))
      if (!berichtHtml && !keuze.bestanden.length && !keuze.links.length && !bronnen.length) {
        throw new Weigering('De subtaak Oplevering is nog leeg. Zet de tekst voor de aanvrager in de beschrijving en de bestanden als bijlage.')
      }
      const teGroot = teGrootMelding(keuze)
      if (teGroot) throw new Weigering(teGroot)

      const builds = bronnen.length ? await previewsKlaarzetten(aanvraag, bronnen, naPreview) : []
      const wachtOpPreview = builds.some((b) => b.status !== 'klaar')
      const previews = builds.filter((b) => b.status === 'klaar').flatMap((b) => b.previews.map((p) => ({ naam: p.naam, url: previewUrl(p.slug) })))

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
      const versie = (await db.aantalVerstuurd(aanvraag.id)) + 1
      const bijlagenAdmin = keuze.bestanden.map((b) => ({ naam: b.naam, bytes: b.bytes ?? 0 }))

      if (!proef) {
        const status = wachtOpPreview ? 'wacht_op_preview' as const : 'bezig' as const
        if (rij) {
          // Een eerdere poging met deze subtaak mislukte (of bleef hangen, of wachtte op de
          // 3D-preview): dezelfde rij opnieuw.
          const patch = { versie, ontvangers: aan, bijlagen: bijlagenAdmin, status, fout: null, created_at: now().toISOString(), door, herinneren: true }
          if (rij.status === 'wacht_op_preview' && status === 'bezig') {
            // Twee meldingen tegelijk (twee kolommen klaar), of een melding en een druk op de knop:
            // wie hem het eerst oppakt, verstuurt hem.
            if (!(await db.pakWachtendeOplevering(rij.id, patch))) return 'oplevermail al opgepakt'
          } else {
            await db.updateOplevering(rij.id, patch)
          }
        } else {
          // herinneren: tot er akkoord of feedback is, krijgt iedereen die deze mail kreeg
          // elke werkdag een herinnering (scripts/herinneringen.mjs).
          rij = await db.insertOplevering({ aanvraag_id: aanvraag.id, subtaak_gid: subtaak.gid, versie, ontvangers: aan, bijlagen: bijlagenAdmin, status, door, herinneren: true })
        }
      }

      if (!proef && wachtOpPreview) {
        // De mail gaat vanzelf zodra de 3D-repo meldt dat de preview online staat. Na zo'n melding
        // (naPreview) kan er nog een tweede kolom bezig zijn; dan geen nieuwe reactie.
        if (!naPreview) {
          try {
            await asana.addComment(taak.gid, verslagWachtOpPreview(builds.length))
          } catch (e) {
            log('warn', 'reactie over wachten op 3D-preview plaatsen mislukt', { gid: taak.gid, error: fout(e) })
          }
        }
        log('info', 'oplevermail wacht op 3D-preview', { gid: taak.gid, aanvraag: aanvraag.id, bronnen })
        return 'oplevermail wacht op 3D-preview'
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
        previews,
        previewsOnderweg: wachtOpPreview,
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
          await asana.addComment(taak.gid, verslagProef({ naar: proefNaar, aan, bijlagen: bijlagen.map((b) => b.naam), links: linkNamen, previews, previewsOnderweg: wachtOpPreview }))
        } catch (e) {
          log('warn', 'verslag van proefmail plaatsen mislukt', { gid: taak.gid, error: fout(e) })
        }
        await zetVeld(taak.gid, 'proef_verstuurd')
        return 'proefmail verstuurd'
      }

      const moment = now()
      const datum = vandaagInNl(moment)
      // Een vorige versie die nog op akkoord wachtte, hoeft geen herinneringen meer: het gaat nu om
      // deze. Vóór het op verstuurd zetten van deze rij, anders stopt hij zichzelf.
      await db.stopHerinneringen(aanvraag.id, moment, { gestopt: `versie ${versie} verstuurd` }).catch((e) => {
        log('warn', 'herinneringen van vorige versie stoppen mislukt', { aanvraag: aanvraag.id, error: fout(e) })
      })
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
      await nazorg('verslag plaatsen', () => asana.addComment(taak.gid, verslagVerstuurd({ versie, aan, bijlagen: bijlagen.map((b) => b.naam), links: linkNamen, datum, previews })))
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
