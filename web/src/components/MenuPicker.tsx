import { Combobox, ComboboxInput, ComboboxOption, ComboboxOptions } from '@headlessui/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { LETTERS } from './ChoiceList'
import { Icon } from './Icon'
import {
  ALLE_GERECHTEN, PAKKETGROEPEN, type MenuKeuze, aantalGerechten, gerechtVan,
  gerechtenInPakket, isBekend, leegMenu, letterVoorPakket, pakketVan, regelVan,
  sectiesVan, uitPakket,
} from '../lib/menu'

const REGELS = ALLE_GERECHTEN.map(regelVan)

const vergelijkbaar = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * De pakketkeuze: drie korte lijsten in plaats van negen kaarten op een rij.
 *
 * Wat makkelijk te verwarren is staat nu onder elkaar - Basic en Standard, met de
 * vega-variant ernaast - en onder elke naam staan de gangen, zodat je het verschil
 * ziet zonder het pakket te openen. Het aantal rechts is het aantal gerechten.
 *
 * De letters lopen door over de groepen heen, in de volgorde waarin ze op het scherm
 * staan; PAKKETTEN_OP_SCHERM is dezelfde lijst waar de lettertoets in App.tsx op zoekt.
 */
function Pakketkeuze({ onKies }: { onKies: (pakket: string) => void }) {
  const rootRef = useRef<HTMLDivElement>(null)
  // Focus op het blok, zodat de lettertoetsen werken zonder dat een knop gekozen oogt.
  useEffect(() => {
    const t = window.setTimeout(() => rootRef.current?.focus({ preventScroll: true }), 0)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <div className="pakketten" role="radiogroup" ref={rootRef} tabIndex={-1} data-choice-list>
      {PAKKETGROEPEN.map((groep) => (
        <div className="pakketgroep" key={groep.kop}>
          <div className="pakketgroep__kop">{groep.kop}</div>
          <div className="pakketgroep__lijst">
            {groep.pakketten.map((sleutel) => {
              const p = pakketVan(sleutel)
              if (!p) return null
              const letter = letterVoorPakket(sleutel)
              const { tekst, meer } = sectiesVan(p)
              return (
                <button
                  key={sleutel}
                  type="button"
                  className="opt pakket"
                  role="radio"
                  aria-checked={false}
                  onClick={() => onKies(sleutel)}
                  data-letter={letter === null ? undefined : LETTERS[letter]}
                >
                  <span className="opt__key" aria-hidden="true">{letter === null ? '' : LETTERS[letter]}</span>
                  <span className="pakket__tekst">
                    <span className="pakket__naam">{p.naam}</span>
                    <span className="pakket__gangen">
                      {tekst}
                      {meer ? <span className="pakket__meer"> +{meer}</span> : null}
                    </span>
                  </span>
                  <span className="pakket__aantal">{gerechtenInPakket(p)} gerechten</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Een gerecht kiezen uit het repertoire, of er zelf een intypen. Kiezen heeft de
 * voorkeur: dan staat het op het scherm precies zoals de ontwerper het zette. Wie
 * zelf typt mag dat, maar krijgt te zien dat dit gerecht nieuw is.
 */
function GerechtKiezer({ waarde, onKies, onAnnuleer }: {
  waarde: string
  onKies: (regel: string) => void
  onAnnuleer: () => void
}) {
  const [query, setQuery] = useState(waarde)
  const treffers = useMemo(() => {
    const q = vergelijkbaar(query.trim())
    if (!q) return REGELS.slice(0, 12)
    return REGELS.filter((r) => vergelijkbaar(r).includes(q)).slice(0, 12)
  }, [query])
  const eigen = query.trim() && !REGELS.some((r) => r === query.trim())

  return (
    <div className="gerecht__kiezer">
      <Combobox
        value={query}
        onChange={(v: string | null) => { if (v) onKies(v) }}
        immediate
      >
        <ComboboxInput
          autoFocus
          className="field combo__input"
          displayValue={() => query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); onAnnuleer() }
            // Enter op eigen tekst: overnemen zoals het er staat.
            if (e.key === 'Enter' && eigen && !treffers.length) {
              e.preventDefault()
              onKies(query.trim())
            }
          }}
          placeholder="Zoek een gerecht, of typ er zelf een"
        />
        <ComboboxOptions className="combo__list" modal={false}>
          {treffers.map((r) => (
            <ComboboxOption key={r} value={r} className="combo__opt">
              <span>{r}</span>
            </ComboboxOption>
          ))}
          {eigen ? (
            <ComboboxOption value={query.trim()} className="combo__opt combo__opt--eigen">
              <Icon name="alert" />
              <span>Gebruik “{query.trim()}” — staat niet in de gerechtenlijst</span>
            </ComboboxOption>
          ) : null}
          {!treffers.length && !eigen ? <div className="combo__empty">Niets gevonden.</div> : null}
        </ComboboxOptions>
      </Combobox>
      <button type="button" className="gerecht__knop" onClick={onAnnuleer} aria-label="Annuleren">
        <Icon name="close" />
      </button>
    </div>
  )
}

/**
 * Een gerecht zoals het op het scherm komt te staan: de naam op zijn eigen regel,
 * de ingredienten daaronder. Abel: "Ik wil dat de gerechten zo staan zoals op de
 * schermen." Dat is niet alleen mooier - zo zie je bij het kiezen al wat je straks
 * krijgt, in plaats van een regel met strepen die nergens zo staat.
 */
function Gerechtregel({ regel }: { regel: string }) {
  const g = gerechtVan(regel)
  return (
    <>
      <span className="gerecht__naam">{g.naam}</span>
      {g.ingredienten?.length ? (
        <span className="gerecht__ingredienten">{g.ingredienten.join(' | ')}</span>
      ) : null}
      {g.onderdelen?.length ? (
        <span className="gerecht__onderdelen">
          {g.onderdelen.map((o) => (
            <span className="gerecht__onderdeel" key={o.naam}>
              <span className="gerecht__bullet">{o.naam}</span>
              {o.toelichting?.length ? (
                <span className="gerecht__toelichting">{o.toelichting.join(' | ')}</span>
              ) : null}
            </span>
          ))}
        </span>
      ) : null}
    </>
  )
}

interface Props {
  menu: MenuKeuze
  onChange: (menu: MenuKeuze) => void
}

export function MenuPicker({ menu, onChange }: Props) {
  // Welke regel staat open om te wisselen: "sectie-index" of "sectie-nieuw".
  const [open, setOpen] = useState<string | null>(null)

  if (!menu.pakket) {
    // Alleen de naam op de kaart: de onderdelen staan een scherm later toch al, en
    // een kaart met een rij kopjes eronder leest als een opsomming die je moet lezen
    // in plaats van een knop die je aanklikt.
    return <Pakketkeuze onKies={(k) => onChange(uitPakket(k))} />
  }

  const pakket = pakketVan(menu.pakket)
  const zet = (si: number, gerechten: string[]) => {
    const secties = menu.secties.map((s, i) => (i === si ? { ...s, gerechten } : s))
    onChange({ ...menu, secties })
  }

  return (
    <div className="menu">
      <div className="menu__kop">
        <span className="menu__pakket">{pakket?.naam}</span>
        <span className="menu__telling">{aantalGerechten(menu)} gerechten</span>
        <button type="button" className="menu__wissel" onClick={() => { setOpen(null); onChange(leegMenu()) }}>
          Ander pakket
        </button>
      </div>

      {menu.secties.map((sectie, si) => (
        <section className="menu__sectie" key={`${sectie.kop ?? 'zonder'}-${si}`}>
          {sectie.kop ? <h3 className="menu__sectiekop">{sectie.kop}</h3> : null}
          <ul className="menu__lijst">
            {sectie.gerechten.map((regel, gi) => (
              <li className="gerecht" key={`${regel}-${gi}`}>
                {open === `${si}-${gi}` ? (
                  <GerechtKiezer
                    waarde={regel}
                    onKies={(nieuw) => {
                      zet(si, sectie.gerechten.map((r, i) => (i === gi ? nieuw : r)))
                      setOpen(null)
                    }}
                    onAnnuleer={() => setOpen(null)}
                  />
                ) : (
                  <>
                    <span className="gerecht__tekst">
                      <Gerechtregel regel={regel} />
                      {isBekend(regel) ? null : (
                        <span className="gerecht__nieuw">
                          <Icon name="alert" /> niet uit de lijst
                        </span>
                      )}
                    </span>
                    <button type="button" className="gerecht__knop" onClick={() => setOpen(`${si}-${gi}`)}>
                      Wissel
                    </button>
                    <button
                      type="button"
                      className="gerecht__knop gerecht__knop--weg"
                      aria-label={`${regel} weghalen`}
                      onClick={() => zet(si, sectie.gerechten.filter((_, i) => i !== gi))}
                    >
                      <Icon name="close" />
                    </button>
                  </>
                )}
              </li>
            ))}
            <li className="gerecht gerecht--nieuw">
              {open === `${si}-nieuw` ? (
                <GerechtKiezer
                  waarde=""
                  onKies={(nieuw) => { zet(si, [...sectie.gerechten, nieuw]); setOpen(null) }}
                  onAnnuleer={() => setOpen(null)}
                />
              ) : (
                <button type="button" className="gerecht__toevoegen" onClick={() => setOpen(`${si}-nieuw`)}>
                  + Gerecht toevoegen
                </button>
              )}
            </li>
          </ul>
        </section>
      ))}
    </div>
  )
}
