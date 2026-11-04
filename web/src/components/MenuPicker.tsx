import { Combobox, ComboboxInput, ComboboxOption, ComboboxOptions } from '@headlessui/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { LETTERS } from './ChoiceList'
import { Icon } from './Icon'
import {
  MENU_TALEN, PAKKETGROEPEN, type Gerechtkeuze, type MenuKeuze, type MenuTaal, aantalGerechten, bibliotheek,
  gerechtVan, inTaal, ingredientenRegel, isBekend, leegMenu, letterVoorPakket, metIngredienten,
  metNaam, metOnderdeel, pakketInTaal, pakketVan, pakketgroepen, regelVan, sectiesVan, taalVan, uitPakket,
} from '../lib/menu'

/** Alle gerechten van een taal als regel; daar zoekt "Wissel" en "Gerecht toevoegen" in. */
const regelsVan = (taal: MenuTaal) => bibliotheek(taal).gerechten.map(regelVan)

const vergelijkbaar = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * De pakketkeuze: drie korte lijsten in plaats van negen kaarten op een rij.
 *
 * Wat makkelijk te verwarren is staat nu onder elkaar - Basic en Standard, met de
 * vega-variant ernaast - en onder elke naam staan de gangen, zodat je het verschil
 * ziet zonder het pakket te openen.
 *
 * De letters lopen door over de groepen heen, in de volgorde waarin ze op het scherm
 * staan; PAKKETTEN_OP_SCHERM is dezelfde lijst waar de lettertoets in App.tsx op zoekt.
 */
/**
 * Nederlands of Engels. Staat boven de pakketten, want de taal bepaalt welke pakketten er zijn: in
 * het Engels nog niet allemaal. De pakketten die er (nog) niet in het Engels zijn, staan er wel,
 * maar uitgegrijsd, zodat niemand denkt dat ze weg zijn.
 */
function Taalkeuze({ taal, onKies }: { taal: MenuTaal; onKies: (taal: MenuTaal) => void }) {
  return (
    <div className="menutaal" role="radiogroup" aria-label="Taal van het menu">
      <span className="menutaal__label">Taal van het menu</span>
      <span className="menutaal__knoppen">
        {MENU_TALEN.map((t) => (
          <button
            key={t.key}
            type="button"
            role="radio"
            aria-checked={taal === t.key}
            className={`menutaal__knop${taal === t.key ? ' is-gekozen' : ''}`}
            onClick={() => onKies(t.key)}
          >
            {t.label}
          </button>
        ))}
      </span>
    </div>
  )
}

function Pakketkeuze({ taal, onKies, onTaal }: { taal: MenuTaal; onKies: (pakket: string) => void; onTaal: (taal: MenuTaal) => void }) {
  const rootRef = useRef<HTMLDivElement>(null)
  // Focus op het blok, zodat de lettertoetsen werken zonder dat een knop gekozen oogt.
  useEffect(() => {
    const t = window.setTimeout(() => rootRef.current?.focus({ preventScroll: true }), 0)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <div className="pakketten" ref={rootRef} tabIndex={-1} data-choice-list>
      <Taalkeuze taal={taal} onKies={onTaal} />
      {/* Alleen nodig zolang niet elk pakket er in het Engels is. */}
      {taal === 'en' && pakketgroepen('en').flatMap((g) => g.pakketten).length < pakketgroepen('nl').flatMap((g) => g.pakketten).length ? (
        <p className="menutaal__uitleg">
          In het Engels zijn er nu {pakketgroepen('en').flatMap((g) => g.pakketten).length} pakketten. De andere komen later.
        </p>
      ) : null}
      {PAKKETGROEPEN.map((groep) => (
        <div className="pakketgroep" key={groep.kop}>
          <div className="pakketgroep__kop">{groep.kop}</div>
          <div className="pakketgroep__lijst" role="radiogroup" aria-label={groep.kop}>
            {groep.pakketten.map((sleutel) => {
              const beschikbaar = pakketInTaal(sleutel, taal)
              // Niet in deze taal: de Nederlandse naam, uitgegrijsd en niet te kiezen.
              const p = pakketVan(sleutel, beschikbaar ? taal : 'nl')
              if (!p) return null
              const letter = beschikbaar ? letterVoorPakket(sleutel, taal) : null
              const { tekst, meer } = sectiesVan(p)
              return (
                <button
                  key={sleutel}
                  type="button"
                  className={`opt pakket${beschikbaar ? '' : ' pakket--niet'}`}
                  role="radio"
                  aria-checked={false}
                  disabled={!beschikbaar}
                  onClick={() => onKies(sleutel)}
                  data-letter={letter === null ? undefined : LETTERS[letter]}
                >
                  <span className="opt__key" aria-hidden="true">{letter === null ? '' : LETTERS[letter]}</span>
                  <span className="pakket__tekst">
                    <span className="pakket__naam">{p.naam}</span>
                    <span className="pakket__gangen">
                      {beschikbaar ? (
                        <>
                          {tekst}
                          {meer ? <span className="pakket__meer"> +{meer}</span> : null}
                        </>
                      ) : 'Nog niet in het Engels'}
                    </span>
                  </span>
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
function GerechtKiezer({ waarde, taal, onKies, onAnnuleer }: {
  waarde: string
  taal: MenuTaal
  onKies: (regel: string) => void
  onAnnuleer: () => void
}) {
  const [query, setQuery] = useState(waarde)
  const regels = useMemo(() => regelsVan(taal), [taal])
  const treffers = useMemo(() => {
    const q = vergelijkbaar(query.trim())
    if (!q) return regels.slice(0, 12)
    return regels.filter((r) => vergelijkbaar(r).includes(q)).slice(0, 12)
  }, [query, regels])
  const eigen = query.trim() && !regels.some((r) => r === query.trim())

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
          placeholder={taal === 'en' ? 'Zoek een Engels gerecht, of typ er zelf een' : 'Zoek een gerecht, of typ er zelf een'}
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
 * Een stukje tekst waar je direct in typt.
 *
 * Geen rand, geen vlak, hetzelfde lettertype en dezelfde kleur als de tekst eromheen:
 * het ziet eruit als tekst, maar je klikt erin en je typt. Een textarea en geen input,
 * want een ingredientenregel loopt door naar de volgende regel; de hoogte groeit mee.
 *
 * Enter sluit het veld af in plaats van een regel te maken - dit is één regel tekst, en
 * de globale Enter-afhandeling laat een textarea met rust, dus hier moet het zelf.
 */
function Veld({ waarde, onChange, className, label, plaatshouder }: {
  waarde: string
  onChange: (v: string) => void
  className?: string
  label: string
  plaatshouder?: string
}) {
  // Tijdens het typen houdt het veld zijn eigen tekst vast en gaat er pas bij het
  // verlaten iets naar het menu. Dat moet ook wel: een ingredientenregel wordt bij het
  // opslaan op de strepen uit elkaar gehaald en lege stukken vallen weg, dus wie "zalm |"
  // typt zou de streep meteen weer kwijt zijn en nooit aan het tweede ingredient
  // toekomen. Hetzelfde geldt voor de spatie aan het eind van een woord.
  const [tekst, setTekst] = useState(waarde)
  const typt = useRef(false)
  useEffect(() => { if (!typt.current) setTekst(waarde) }, [waarde])

  const ref = useRef<HTMLTextAreaElement>(null)
  const groeiMee = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }
  useEffect(groeiMee, [tekst])

  return (
    <textarea
      ref={ref}
      className={`veld-in-tekst${className ? ` ${className}` : ''}`}
      value={tekst}
      rows={1}
      aria-label={label}
      placeholder={plaatshouder}
      onFocus={() => { typt.current = true }}
      onChange={(e) => setTekst(e.target.value)}
      onBlur={() => { typt.current = false; onChange(tekst) }}
      onKeyDown={(e) => {
        // Eén regel tekst, dus Enter is "klaar" en geen nieuwe regel. Escape zet terug
        // wat er stond, zoals overal waar je iets kunt afbreken.
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
        if (e.key === 'Escape') { e.preventDefault(); setTekst(waarde); typt.current = false }
      }}
    />
  )
}

/**
 * Een gerecht zoals het op het scherm komt te staan: de naam op zijn eigen regel,
 * de ingredienten daaronder. Abel: "Ik wil dat de gerechten zo staan zoals op de
 * schermen." Dat is niet alleen mooier - zo zie je bij het kiezen al wat je straks
 * krijgt, in plaats van een regel met strepen die nergens zo staat.
 */
function Gerechtregel({ gerecht, onChange }: {
  gerecht: Gerechtkeuze
  onChange: (g: Gerechtkeuze) => void
}) {
  return (
    <>
      <Veld
        className="gerecht__naam"
        waarde={gerecht.naam}
        label={`naam van ${gerecht.naam || 'dit gerecht'}`}
        onChange={(v) => onChange(metNaam(gerecht, v))}
      />
      {gerecht.onderdelen?.length ? null : (
        <Veld
          className="gerecht__ingredienten"
          waarde={ingredientenRegel(gerecht)}
          label={`ingrediënten van ${gerecht.naam}`}
          plaatshouder="ingrediënten, met een | ertussen"
          onChange={(v) => onChange(metIngredienten(gerecht, v))}
        />
      )}
      {gerecht.onderdelen?.length ? (
        <span className="gerecht__onderdelen">
          {gerecht.onderdelen.map((o, i) => (
            <span className="gerecht__onderdeel" key={i}>
              <span className="gerecht__bullet">
                <Veld
                  waarde={o.naam}
                  label={`naam van onderdeel ${i + 1}`}
                  onChange={(v) => onChange(metOnderdeel(gerecht, i, { naam: v }))}
                />
              </span>
              <Veld
                className="gerecht__toelichting"
                waarde={(o.toelichting ?? []).join(' | ')}
                label={`toelichting bij ${o.naam}`}
                plaatshouder="toelichting, met een | ertussen"
                onChange={(v) => onChange(metOnderdeel(gerecht, i, { toelichting: v }))}
              />
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

  const taal = taalVan(menu)

  if (!menu.pakket) {
    // Alleen de naam op de kaart: de onderdelen staan een scherm later toch al, en
    // een kaart met een rij kopjes eronder leest als een opsomming die je moet lezen
    // in plaats van een knop die je aanklikt.
    return <Pakketkeuze taal={taal} onKies={(k) => onChange(uitPakket(k, taal))} onTaal={(t) => onChange(leegMenu(t))} />
  }

  const pakket = pakketVan(menu.pakket, taal)
  const zet = (si: number, gerechten: Gerechtkeuze[]) => {
    const secties = menu.secties.map((s, i) => (i === si ? { ...s, gerechten } : s))
    onChange({ ...menu, secties })
  }

  return (
    <div className="menu">
      <div className="menu__kop">
        <span className="menu__pakket">{pakket?.naam}</span>
        <span className="menu__telling">{aantalGerechten(menu)} gerechten · {taal === 'en' ? 'Engels' : 'Nederlands'}</span>
        <button type="button" className="menu__wissel" onClick={() => { setOpen(null); onChange(leegMenu(taal)) }}>
          Pakket wijzigen
        </button>
      </div>
      {/* Van taal wisselen kan hier ook, als het pakket in de andere taal bestaat. */}
      {pakketInTaal(menu.pakket, taal === 'en' ? 'nl' : 'en') ? (
        <button
          type="button"
          className="link menu__taalwissel"
          onClick={() => { setOpen(null); onChange(inTaal(menu, taal === 'en' ? 'nl' : 'en')) }}
        >
          {taal === 'en' ? 'Toch in het Nederlands' : 'Dit menu in het Engels'}
        </button>
      ) : null}

      {menu.secties.map((sectie, si) => (
        <section className="menu__sectie" key={`${sectie.kop ?? 'zonder'}-${si}`}>
          {sectie.kop ? <h3 className="menu__sectiekop">{sectie.kop}</h3> : null}
          <ul className="menu__lijst">
            {sectie.gerechten.map((gerecht, gi) => (
              // De sleutel is de plek en niet de tekst: wie in de naam typt verandert de
              // tekst bij elke aanslag, en met de tekst als sleutel bouwt React het veld
              // dan opnieuw op en springt de cursor naar het eind.
              <li className="gerecht" key={`${si}-${gi}`}>
                {open === `${si}-${gi}` ? (
                  <GerechtKiezer
                    waarde={regelVan(gerecht)}
                    taal={taal}
                    onKies={(nieuw) => {
                      zet(si, sectie.gerechten.map((g, i) => (i === gi ? gerechtVan(nieuw, taal) : g)))
                      setOpen(null)
                    }}
                    onAnnuleer={() => setOpen(null)}
                  />
                ) : (
                  <>
                    <span className="gerecht__tekst">
                      <Gerechtregel
                        gerecht={gerecht}
                        onChange={(g) => zet(si, sectie.gerechten.map((h, i) => (i === gi ? g : h)))}
                      />
                      {isBekend(gerecht, taal) ? null : (
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
                      aria-label={`${gerecht.naam} weghalen`}
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
                  taal={taal}
                  onKies={(nieuw) => { zet(si, [...sectie.gerechten, gerechtVan(nieuw, taal)]); setOpen(null) }}
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
