import { useCallback, useRef, useState } from 'react'
import { MAX_BIJLAGEN, MAX_BIJLAGEN_BYTES_TOTAAL, bestandProbleem, bestandsnaamOpschonen, formatBytes } from '../../../shared/bijlagen'
import { ApiError, uploadBestand, vraagUploadlinks } from './api'

/**
 * Het uploaden van meegestuurde bestanden. Los van het component, zodat de regels te volgen en te
 * testen zijn zonder een browser erbij te halen.
 *
 * Uploaden gebeurt meteen bij het kiezen, niet bij het versturen: dan staat het bestand er al tegen
 * de tijd dat iemand de laatste vragen heeft ingevuld, en hoeft niemand bij het afronden naar een
 * balk te staren.
 */

export interface Bijlage {
  /** Alleen in deze browser; het echte id komt pas terug van de server. */
  lokaalId: string
  bestandsnaam: string
  bytes: number
  mime: string
  status: 'wacht' | 'bezig' | 'klaar' | 'fout'
  /** 0 tot 1. */
  voortgang: number
  bijlageId?: string
  fout?: string
}

export interface Uploads {
  bijlagen: Bijlage[]
  kies(files: FileList | File[]): void
  verwijder(lokaalId: string): void
  /** Metadata uit een hervat concept; alleen wat al geüpload was doet nog mee. */
  herstel(bewaard: Bijlage[]): void
  /** Er wordt nog geüpload — versturen kan nog niet. */
  bezig: boolean
  /** De ids die met de aanvraag meegestuurd worden. */
  ids: string[]
}

export function useBijlagen(doel: 'aanvraag' | 'aanvulling'): Uploads {
  const [bijlagen, setBijlagen] = useState<Bijlage[]>([])
  // De lijst in een ref is leidend. Zo kunnen `kies` en de uploadlus hem lezen en bijwerken zonder
  // dat er iets in een setState-functie hoeft te gebeuren — die mag React namelijk twee keer
  // aanroepen, en dan zou hetzelfde bestand twee keer geüpload worden.
  const lijst = useRef<Bijlage[]>([])
  // De bestanden zelf blijven buiten de state: ze zijn niet serialiseerbaar en horen niet in een
  // concept dat in de browser wordt bewaard.
  const bestanden = useRef(new Map<string, File>())
  const groepId = useRef(crypto.randomUUID())

  const publiceer = useCallback((nieuw: Bijlage[]) => {
    lijst.current = nieuw
    setBijlagen(nieuw)
  }, [])

  const pas = useCallback(
    (lokaalId: string, patch: Partial<Bijlage>) => {
      publiceer(lijst.current.map((b) => (b.lokaalId === lokaalId ? { ...b, ...patch } : b)))
    },
    [publiceer],
  )

  const upload = useCallback(
    async (nieuwe: Bijlage[]) => {
      if (!nieuwe.length) return
      try {
        const links = await vraagUploadlinks({
          doel,
          groep_id: groepId.current,
          bestanden: nieuwe.map((b) => ({ naam: b.bestandsnaam, type: b.mime, grootte: b.bytes })),
        })

        // Eén voor één: de volgorde blijft herkenbaar en een trage verbinding raakt niet verstopt.
        for (const [i, bijlage] of nieuwe.entries()) {
          const link = links[i]
          const file = bestanden.current.get(bijlage.lokaalId)
          // Weggehaald terwijl de link werd opgehaald? Dan overslaan.
          if (!link || !file) continue
          pas(bijlage.lokaalId, { status: 'bezig', voortgang: 0 })
          try {
            await uploadBestand(link, file, (deel) => pas(bijlage.lokaalId, { voortgang: deel }))
            pas(bijlage.lokaalId, { status: 'klaar', voortgang: 1, bijlageId: link.bijlage_id, fout: undefined })
          } catch (e) {
            pas(bijlage.lokaalId, { status: 'fout', fout: e instanceof ApiError ? e.message : 'Uploaden mislukt. Probeer het opnieuw.' })
          }
        }
      } catch (e) {
        const melding = e instanceof ApiError ? e.message : 'Uploaden mislukt. Probeer het opnieuw.'
        for (const b of nieuwe) pas(b.lokaalId, { status: 'fout', fout: melding })
      }
    },
    [doel, pas],
  )

  const kies = useCallback(
    (gekozen: FileList | File[]) => {
      const files = Array.from(gekozen)
      if (!files.length) return

      const meetellend = lijst.current.filter((b) => b.status !== 'fout')
      let aantal = meetellend.length
      let totaal = meetellend.reduce((n, b) => n + b.bytes, 0)
      const nieuw: Bijlage[] = []

      for (const file of files) {
        const lokaalId = crypto.randomUUID()
        const basis: Bijlage = {
          lokaalId,
          bestandsnaam: bestandsnaamOpschonen(file.name),
          bytes: file.size,
          mime: file.type,
          status: 'fout',
          voortgang: 0,
        }

        const probleem = bestandProbleem(file.name, file.type, file.size)
        if (probleem) {
          nieuw.push({ ...basis, fout: probleem })
          continue
        }
        if (aantal >= MAX_BIJLAGEN) {
          nieuw.push({ ...basis, fout: `Je kunt maximaal ${MAX_BIJLAGEN} bestanden meesturen.` })
          continue
        }
        if (totaal + file.size > MAX_BIJLAGEN_BYTES_TOTAAL) {
          nieuw.push({ ...basis, fout: `Samen mag het maximaal ${formatBytes(MAX_BIJLAGEN_BYTES_TOTAAL)} zijn.` })
          continue
        }

        aantal++
        totaal += file.size
        bestanden.current.set(lokaalId, file)
        nieuw.push({ ...basis, status: 'wacht' })
      }

      publiceer([...lijst.current, ...nieuw])
      void upload(nieuw.filter((b) => b.status === 'wacht'))
    },
    [publiceer, upload],
  )

  const verwijder = useCallback(
    (lokaalId: string) => {
      bestanden.current.delete(lokaalId)
      // Het bestand blijft nog even in de opslag staan; de nachtelijke opruimer haalt het weg. Een
      // eigen verwijderendpoint zou een eigen autorisatieverhaal nodig hebben voor weinig winst.
      publiceer(lijst.current.filter((b) => b.lokaalId !== lokaalId))
    },
    [publiceer],
  )

  const herstel = useCallback(
    (bewaard: Bijlage[]) => {
      // Alleen wat al geüpload was heeft nog betekenis: het echte bestand is weg uit deze browser.
      publiceer(bewaard.filter((b) => b.status === 'klaar' && b.bijlageId))
    },
    [publiceer],
  )

  return {
    bijlagen,
    kies,
    verwijder,
    herstel,
    bezig: bijlagen.some((b) => b.status === 'wacht' || b.status === 'bezig'),
    ids: bijlagen.filter((b) => b.status === 'klaar' && b.bijlageId).map((b) => b.bijlageId as string),
  }
}
