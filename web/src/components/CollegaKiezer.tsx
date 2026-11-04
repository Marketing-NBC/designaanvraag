import { useEffect, useMemo, useRef, useState } from 'react'
import { MAX_GEKOPPELDEN } from '../../../shared/aanvraag-schema'
import { Icon } from './Icon'

interface Props {
  /** Alle collega's uit de lijst. */
  namen: string[]
  /** Wie er nu aangevinkt is. */
  value: string[]
  onChange: (namen: string[]) => void
  /** De aanvrager zelf: die staat er al op en hoeft niet gekoppeld te worden. */
  zelf?: string
  /** Bij een aanvulling: wie er al aan de aanvraag hangt. Die staan er al op en zijn niet te kiezen. */
  alGekoppeld?: string[]
}

const vergelijkbaar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/**
 * Collega's aan een aanvraag koppelen: aanvinken, niet typen.
 *
 * Alleen namen uit de lijst, en geen mailadressen. Het formulier staat op het open internet; met een
 * vrij adresveld kan iedereen er via ons postvak mail mee laten versturen. De adressen staan bij de
 * collega in Supabase en zijn niet publiek: de function zoekt ze erbij.
 *
 * Wat koppelen betekent staat er meteen bij, want "op de hoogte blijven" is vaag: je krijgt de
 * bevestiging, de mail als het klaar is, en de herinnering om akkoord te geven.
 */
export function CollegaKiezer({ namen, value, onChange, zelf = '', alGekoppeld = [] }: Props) {
  const [zoek, setZoek] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const t = window.setTimeout(() => rootRef.current?.focus({ preventScroll: true }), 0)
    return () => window.clearTimeout(t)
  }, [])

  const uitgesloten = useMemo(
    () => new Set([zelf, ...alGekoppeld].map(vergelijkbaar).filter(Boolean)),
    [zelf, alGekoppeld],
  )
  const keuze = useMemo(() => namen.filter((n) => !uitgesloten.has(vergelijkbaar(n))), [namen, uitgesloten])
  const zichtbaar = useMemo(() => {
    const q = vergelijkbaar(zoek)
    return q ? keuze.filter((n) => vergelijkbaar(n).includes(q)) : keuze
  }, [keuze, zoek])
  const gekozen = new Set(value.map(vergelijkbaar))
  const vol = value.length >= MAX_GEKOPPELDEN

  const wissel = (naam: string) => {
    const k = vergelijkbaar(naam)
    if (gekozen.has(k)) onChange(value.filter((v) => vergelijkbaar(v) !== k))
    else if (!vol) onChange([...value, naam])
  }

  return (
    <div className="collegas" ref={rootRef} tabIndex={-1}>
      <div className="collegas__uitleg">
        <strong>Wat krijgen ze?</strong>
        <ul>
          <li>Een bevestiging dat de aanvraag binnen is.</li>
          <li>De mail als het ontwerp klaar is, met de bestanden.</li>
          <li>Elke werkdag een herinnering tot iemand akkoord geeft of feedback stuurt.</li>
        </ul>
        <span>
          Iedereen die gekoppeld is mag akkoord geven. Staat iemand niet in de lijst? Vraag Marketing
          om die collega toe te voegen.
        </span>
      </div>

      {alGekoppeld.length ? (
        <p className="hint collegas__al">Al gekoppeld: {alGekoppeld.join(', ')}</p>
      ) : null}

      {keuze.length > 8 ? (
        <input
          className="field collegas__zoek"
          type="search"
          value={zoek}
          onChange={(e) => setZoek(e.target.value)}
          placeholder="Zoek een collega"
          aria-label="Zoek een collega"
          autoComplete="off"
          spellCheck={false}
        />
      ) : null}

      {keuze.length ? (
        <div className="collegas__lijst" role="group" aria-label="Collega's">
          {zichtbaar.map((naam) => {
            const aan = gekozen.has(vergelijkbaar(naam))
            return (
              <button
                key={naam}
                type="button"
                className="opt collegas__naam"
                aria-pressed={aan}
                disabled={!aan && vol}
                onClick={() => wissel(naam)}
              >
                <span className="opt__label">{naam}</span>
                <Icon name="check" className="opt__check" />
              </button>
            )
          })}
          {!zichtbaar.length ? <p className="hint">Niemand gevonden met "{zoek}".</p> : null}
        </div>
      ) : (
        <p className="hint">De lijst met collega's is niet beschikbaar. Je kunt gewoon doorgaan.</p>
      )}

      <p className="hint collegas__telling" aria-live="polite">
        {value.length
          ? `${value.length === 1 ? '1 collega' : `${value.length} collega's`} gekoppeld${vol ? ` (het maximum is ${MAX_GEKOPPELDEN})` : ''}.`
          : 'Niemand gekoppeld. Dat mag.'}
      </p>
    </div>
  )
}
