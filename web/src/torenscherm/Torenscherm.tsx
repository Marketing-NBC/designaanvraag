import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  SLEUTEL, TORENSCHERM_BREEDTE as W, TORENSCHERM_BUCKET, TORENSCHERM_HOOGTE as H, metaPad, type TorenschermMeta,
} from '../../../shared/torenscherm-preview'
import logo from '../assets/brand/nbc-logo-color-no-payoff.png'
import { formatLong } from '../lib/dates'
import demo from './demo.svg'
import { LOCATIES, type TorenschermFoto } from './locaties'
import { matrix3d } from './perspectief'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined

/** Waar de bestanden van een preview staan: de openbare bucket, in de map van de sleutel. */
function bucketUrl(pad: string): string {
  return `${SUPABASE_URL!.replace(/\/$/, '')}/storage/v1/object/public/${TORENSCHERM_BUCKET}/${pad}`
}

interface Preview {
  meta: TorenschermMeta
  /** Het design zelf. */
  src: string
  /** Hetzelfde bestand, maar zo dat de browser het opslaat onder zijn eigen naam. */
  download: string | null
}

/**
 * Zonder backend (lokaal, en in de e2e-tests) een verzonnen design, zodat de pagina te bekijken is.
 * Met backend bestaat er geen demo: een link zonder geldige sleutel is gewoon niet gevonden.
 */
const DEMO: Preview = {
  meta: {
    bestand: 'demo.svg', mime: 'image/svg+xml', origineel: 'Torenscherm Zorgcongres.svg', naam: 'Torenscherm Zorgcongres',
    locatie: 'nbc', event: 'Zorgcongres', eventDatum: '2026-12-11',
  },
  src: demo,
  download: null,
}

async function haalPreview(sleutel: string | null): Promise<Preview | null> {
  if (!SUPABASE_URL) return DEMO
  if (!sleutel || !SLEUTEL.test(sleutel)) return null
  const res = await fetch(bucketUrl(metaPad(sleutel)), { cache: 'no-cache' })
  if (res.status === 400 || res.status === 404) return null
  if (!res.ok) throw new Error(`Ophalen mislukt (${res.status}).`)
  const meta = (await res.json()) as TorenschermMeta
  const pad = `${sleutel}/${meta.bestand}`
  return { meta, src: bucketUrl(pad), download: `${bucketUrl(pad)}?download=${encodeURIComponent(meta.origineel)}` }
}

/** Het design zelf: een plaatje of gif, of een video die stil en in een lus speelt, zoals op het scherm. */
function Ontwerp({ preview, className }: { preview: Preview; className?: string }) {
  if (preview.meta.mime.startsWith('video/')) {
    return <video className={className} src={preview.src} autoPlay muted loop playsInline aria-label={preview.meta.naam} />
  }
  return <img className={className} src={preview.src} alt={preview.meta.naam} />
}

/** De foto met het design in perspectief op het scherm. */
function OpLocatie({ foto, preview, dichtbij }: { foto: TorenschermFoto; preview: Preview; dichtbij: boolean }) {
  const kader = useRef<HTMLDivElement>(null)
  const [breedte, setBreedte] = useState(0)

  useLayoutEffect(() => {
    const el = kader.current
    if (!el) return
    const meet = () => setBreedte(el.clientWidth)
    meet()
    const ro = new ResizeObserver(meet)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // De foto staat op ware grootte in een "podium" dat we schalen (en bij Dichterbij verschuiven),
  // zodat de hoeken gewoon in pixels van de foto blijven.
  const [vx, vy, vb] = dichtbij ? foto.dichtbij : [0, 0, foto.breedte]
  const schaal = breedte / vb
  return (
    <div className="ts-foto" ref={kader} style={{ aspectRatio: `${foto.breedte} / ${foto.hoogte}` }}>
      <div
        className="ts-podium"
        style={{ width: foto.breedte, height: foto.hoogte, transform: `scale(${schaal}) translate(${-vx}px, ${-vy}px)` }}
      >
        <img className="ts-podium__foto" src={foto.src} alt="" width={foto.breedte} height={foto.hoogte} />
        <div className="ts-scherm" style={{ width: W, height: H, transform: matrix3d(foto.hoeken, W, H) }}>
          <Ontwerp preview={preview} className="ts-scherm__ontwerp" />
          <div className="ts-scherm__glans" />
        </div>
      </div>
    </div>
  )
}

export function Torenscherm() {
  const [preview, setPreview] = useState<Preview | null | 'laden'>('laden')
  const [fout, setFout] = useState<string | null>(null)
  const [dichtbij, setDichtbij] = useState(false)

  useEffect(() => {
    const sleutel = new URLSearchParams(window.location.search).get('p')?.trim().toLowerCase() ?? null
    haalPreview(sleutel)
      .then(setPreview)
      .catch((e) => {
        setPreview(null)
        setFout(e instanceof Error ? e.message : 'Ophalen mislukt.')
      })
  }, [])

  useEffect(() => {
    if (preview && preview !== 'laden') {
      document.title = `${preview.meta.event || preview.meta.naam} op het torenscherm · NBC`
    }
  }, [preview])

  const foto = preview && preview !== 'laden' ? LOCATIES[preview.meta.locatie] ?? LOCATIES.nbc! : null

  return (
    <div className="ts">
      <header className="ts-kop">
        <img className="ts-kop__logo" src={logo} alt="NBC" />
        <span className="ts-kop__meta">torenscherm</span>
      </header>

      <main className="ts-inhoud">
        {preview === 'laden' && <p className="ts-tekst ts-tekst--stil" role="status">Even laden…</p>}

        {preview === null && (
          <section className="ts-leeg">
            <h1 className="ts-titel">Deze preview is niet gevonden</h1>
            <p className="ts-tekst">
              {fout ?? 'Misschien is de link niet helemaal meegekomen. Open hem nog eens vanuit de mail, of vraag Marketing om een nieuwe.'}
            </p>
          </section>
        )}

        {preview && preview !== 'laden' && foto && (
          <>
            <section className="ts-intro">
              <p className="ts-overline">Preview torenscherm</p>
              <h1 className="ts-titel">{preview.meta.event || preview.meta.naam}</h1>
              {preview.meta.eventDatum && <p className="ts-tekst ts-tekst--stil">{formatLong(preview.meta.eventDatum)}</p>}
            </section>

            <figure className="ts-figuur">
              <OpLocatie foto={foto} preview={preview} dichtbij={dichtbij} />
              <figcaption className="ts-onderschrift">
                <span>Zo staat je design op het torenscherm {foto.plek}.</span>
                <button type="button" className="btn btn--ghost btn--sm" aria-pressed={dichtbij} onClick={() => setDichtbij((d) => !d)}>
                  {dichtbij ? 'Hele foto' : 'Dichterbij'}
                </button>
              </figcaption>
            </figure>

            <section className="ts-ontwerp">
              <h2 className="ts-subkop">Het design</h2>
              <div className="ts-plat" style={{ aspectRatio: `${W} / ${H}` }}>
                <Ontwerp preview={preview} className="ts-plat__ontwerp" />
              </div>
              <div className="ts-onderschrift">
                <span>
                  {preview.meta.origineel}
                  <span className="ts-tekst--stil"> · het scherm is {W} × {H} pixels</span>
                </span>
                {preview.download && (
                  <a className="btn btn--primary btn--sm" href={preview.download}>
                    Download
                  </a>
                )}
              </div>
              <p className="ts-tekst ts-tekst--stil ts-voet">
                Iets aan te passen of is het goed? Gebruik de knoppen <strong>Feedback geven</strong> of <strong>Akkoord geven</strong> in de mail.
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
