import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { AanvullingResult, GevondenAanvraag } from '../../shared/aanvulling-schema'
import { ZOEK_MIN_TEKENS } from '../../shared/aanvulling-schema'
import { SOORT_KEUZES, describeRequestTypes, type Soort } from '../../shared/request-types'
import { ChoiceList, LETTERS } from './components/ChoiceList'
import { FileField } from './components/FileField'
import { DateField } from './components/DateField'
import { Icon } from './components/Icon'
import { NameCombobox } from './components/NameCombobox'
import { PrimaryAction, Question } from './components/Question'
import { Shell } from './components/Shell'
import { TextArea, TextField } from './components/TextField'
import { ApiError, verstuurAanvulling, zoekAanvragen, zoekInterneAanvragen } from './lib/api'
import { useBijlagen, type Uploads } from './lib/uploads'
import { formatShort, isBeforeToday, todayIso } from './lib/dates'

/**
 * Tweede, korte flow: iets nasturen op een aanvraag die al loopt.
 *
 * Bewust géén gebruik van de STEPS-machinerie van het hoofdformulier. Die koppelt elke stap aan een
 * vaste sleutel in `Draft`, en dat zou hier verbogen moeten worden voor een handvol vragen waarvan
 * het zoeken een heel eigen scherm heeft. De losse bouwstenen — Shell, Question, ChoiceList —
 * worden wel gedeeld, dus het oogt en werkt hetzelfde.
 *
 * De eerste vraag is of het om een evenement gaat of om iets intern. Een evenement zoek je op
 * eventnaam; een interne aanvraag heeft geen event, die vind je terug op je eigen naam.
 */

type Stap = 'soort' | 'zoek' | 'naam' | 'kies' | 'toelichting' | 'extra'

const STAPPEN: Record<Soort, readonly Stap[]> = {
  evenement: ['soort', 'zoek', 'naam', 'toelichting', 'extra'],
  intern: ['soort', 'naam', 'kies', 'toelichting', 'extra'],
}

interface Props {
  collegas: string[]
  onSluit: () => void
}

interface Draft {
  naam: string
  toelichting: string
  nieuwe_event_datum: string | null
  nieuwe_deadline: string | null
  schijf_locatie: string
  link: string
}

const leeg: Draft = {
  naam: '',
  toelichting: '',
  nieuwe_event_datum: null,
  nieuwe_deadline: null,
  schijf_locatie: '',
  link: '',
}

/** Is de deadline van deze aanvraag al voorbij? Dan moet er een nieuwe bij. */
function deadlineVerlopen(a: Pick<GevondenAanvraag, 'deadline'> | null): boolean {
  return Boolean(a && isBeforeToday(a.deadline))
}

export function Aanvulling({ collegas, onSluit }: Props) {
  const [index, setIndex] = useState(0)
  const [dir, setDir] = useState<1 | -1>(1)
  const [soort, setSoort] = useState<Soort | null>(null)
  const [gekozen, setGekozen] = useState<GevondenAanvraag | null>(null)
  const [draft, setDraft] = useState<Draft>(leeg)
  const [error, setError] = useState<string | null>(null)
  const [errorNonce, setErrorNonce] = useState(0)
  const [busy, setBusy] = useState(false)
  const [klaar, setKlaar] = useState<AanvullingResult | null>(null)
  const uploads = useBijlagen('aanvulling')
  const clientRequestId = useRef(crypto.randomUUID())
  const startedAt = useRef(new Date().toISOString())

  // Zolang er nog niet gekozen is, telt de route van een evenement: die is even lang.
  const stappen = STAPPEN[soort ?? 'evenement']
  const stap: Stap = stappen[index]
  const verlopen = deadlineVerlopen(gekozen)
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }))

  /**
   * Een andere aanvraag gekozen: de datums die je voor de vorige had aangepast horen daar niet bij.
   * Wie een aanvraag met een verlopen deadline kiest, staat straks voor een verplichte nieuwe.
   */
  const kies = (a: GevondenAanvraag | null) => {
    setGekozen(a)
    setDraft((d) => ({ ...d, nieuwe_event_datum: null, nieuwe_deadline: null }))
    setError(null)
  }

  const kiesSoort = (key: string) => {
    if (key === soort) return
    setSoort(key as Soort)
    // Een gevonden aanvraag van de andere soort hoort niet mee naar de volgende vraag.
    kies(null)
  }

  const ga = (naar: number, richting: 1 | -1) => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    setDir(richting)
    setError(null)
    setIndex(naar)
    window.scrollTo({ top: 0 })
  }

  const fout = (msg: string) => {
    setError(msg)
    setErrorNonce((n) => n + 1)
  }

  function valideer(): string | null {
    if (stap === 'soort') return soort ? null : 'Maak een keuze.'
    if (stap === 'zoek' || stap === 'kies') return gekozen ? null : 'Kies de aanvraag waar het over gaat.'
    if (stap === 'naam') {
      const n = draft.naam.trim()
      if (n.length < 2) return 'Vul je naam in.'
      if (n.length > 80) return 'Houd het bij maximaal 80 tekens.'
      return null
    }
    if (stap === 'toelichting') {
      const t = draft.toelichting.trim()
      if (t.length < 5) return 'Vertel kort wat er moet veranderen.'
      if (t.length > 3000) return 'Houd het bij maximaal 3000 tekens.'
      return null
    }
    // Laatste stap: alles is optioneel, behalve een nieuwe deadline als de oude al voorbij is.
    if (uploads.bezig) return 'Je bestanden worden nog geüpload — nog heel even.'
    if (verlopen && !draft.nieuwe_deadline) return 'De deadline van deze aanvraag is al verstreken. Kies een nieuwe deadline.'
    const event = draft.nieuwe_event_datum ?? gekozen?.event_datum ?? ''
    const deadline = draft.nieuwe_deadline ?? gekozen?.deadline ?? ''
    // Is het event al geweest, dan ligt een nieuwe deadline er per definitie na; dat mag dan.
    if (event && event >= todayIso() && deadline && deadline > event) return 'De deadline kan niet na het event liggen.'
    return null
  }

  const volgende = () => {
    const f = valideer()
    if (f) return fout(f)
    if (index < stappen.length - 1) ga(index + 1, 1)
    else void verstuur()
  }

  const vorige = () => (index === 0 ? onSluit() : ga(index - 1, -1))

  async function verstuur() {
    if (!gekozen) return
    setBusy(true)
    setError(null)
    try {
      const result = await verstuurAanvulling({
        aanvulling: {
          aanvraag_id: gekozen.id,
          naam: draft.naam,
          toelichting: draft.toelichting,
          // Wat er bij moet komen staat in de toelichting; een losse keuzelijst daarvoor dubbelde dat.
          extra_types: [],
          anders_tekst: '',
          nieuwe_event_datum: gekozen.soort === 'intern' ? null : draft.nieuwe_event_datum,
          nieuwe_deadline: draft.nieuwe_deadline,
          schijf_locatie: draft.schijf_locatie,
          link: draft.link,
        },
        client_request_id: clientRequestId.current,
        started_at: startedAt.current,
        bijlage_ids: uploads.ids,
        website_confirm: '',
      })
      setKlaar(result)
    } catch (e) {
      fout(e instanceof ApiError ? e.message : 'Versturen mislukt. Probeer het zo nog eens.')
    } finally {
      setBusy(false)
    }
  }

  // Enter stuurt door, net als in het hoofdformulier. In een tekstvak niet: daar zijn regels welkom.
  useEffect(() => {
    if (klaar) return
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      // De keuze evenement/intern toont letters, dus moeten die toetsen ook werken.
      if (stap === 'soort' && !e.altKey && !e.metaKey && !e.ctrlKey && el?.tagName !== 'INPUT') {
        const opt = SOORT_KEUZES[LETTERS.indexOf(e.key.toUpperCase())]
        if (e.key.length === 1 && opt) {
          e.preventDefault()
          kiesSoort(opt.key)
          return
        }
      }
      if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey) return
      // Headless UI heeft met deze Enter al een naam uit de lijst gekozen.
      if (e.defaultPrevented) return
      if (el?.tagName === 'TEXTAREA') return
      // De namenlijst en de zoeklijst doen zelf iets met Enter.
      if (el?.getAttribute('role') === 'combobox' && el.getAttribute('aria-activedescendant')) return
      if (el?.dataset.vondst) return
      e.preventDefault()
      volgende()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (klaar) return <Gelukt result={klaar} gekozen={gekozen} onSluit={onSluit} />

  const titels: Record<Stap, string> = {
    soort: 'Is het voor een evenement of intern?',
    zoek: 'Bij welk event hoort het?',
    naam: 'Wie ben je?',
    kies: 'Over welke aanvraag gaat het?',
    toelichting: 'Wat moet erbij of anders?',
    extra: verlopen ? 'De deadline is verstreken' : 'Verandert er nog iets aan de aanvraag?',
  }
  const hulp: Record<Stap, string | undefined> = {
    soort: 'Dan zoeken we de goede aanvraag erbij.',
    zoek: 'Typ een deel van de eventnaam. Je ziet de aanvragen van de afgelopen maanden.',
    naam: soort === 'intern'
      ? 'Je naam zoals je hem bij de aanvraag invulde; dan zoeken we je interne aanvragen erbij.'
      : 'Dan weet Marketing wie deze aanvulling stuurde.',
    kies: 'Je interne aanvragen van de afgelopen maanden.',
    toelichting: 'Extra wensen, iets wat erbij moet komen, aanvullende informatie of feedback op het concept. Het marketingteam krijgt er meteen bericht van.',
    extra: verlopen
      ? 'Kies eerst een nieuwe deadline. De rest mag je overslaan.'
      : 'Alles hieronder mag je overslaan. Wat je leeg laat, blijft staan zoals het was.',
  }

  return (
    <Shell
      progress={(index + 1) / (stappen.length + 1)}
      counter={`${index + 1} / ${stappen.length}`}
      canPrev
      onPrev={vorige}
      canNext
      onNext={volgende}
    >
      <AnimatePresence mode="wait" custom={dir} initial={false}>
        <motion.div
          key={stap}
          custom={dir}
          initial={{ opacity: 0, y: dir * 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: dir * -24 }}
          transition={{ duration: 0.28 }}
        >
          <Question
            number={index + 1}
            title={titels[stap]}
            help={hulp[stap]}
            error={error}
            errorNonce={errorNonce}
            titleId={`a-vraag-${stap}`}
            footer={
              <PrimaryAction
                label={index === stappen.length - 1 ? 'Versturen' : 'Volgende'}
                onClick={volgende}
                busy={busy}
                hint={stap === 'toelichting' ? null : 'Enter'}
              />
            }
          >
            {stap === 'soort' ? <ChoiceList options={SOORT_KEUZES} value={soort} onToggle={kiesSoort} /> : null}

            {stap === 'zoek' ? <Zoeker gekozen={gekozen} onKies={kies} invalid={Boolean(error)} /> : null}

            {stap === 'naam' ? (
              <NameCombobox
                id="a-naam"
                value={draft.naam}
                onChange={(v) => {
                  patch({ naam: v })
                  // Bij een interne aanvraag hangt de lijst hierna van je naam af.
                  if (soort === 'intern' && gekozen) kies(null)
                }}
                names={collegas}
                invalid={Boolean(error)}
                onEnter={volgende}
              />
            ) : null}

            {stap === 'kies' ? <EigenAanvragen naam={draft.naam} gekozen={gekozen} onKies={kies} /> : null}

            {stap === 'toelichting' ? (
              <TextArea
                id="a-toelichting"
                value={draft.toelichting}
                onChange={(v) => patch({ toelichting: v })}
                maxLength={3000}
                invalid={Boolean(error)}
                placeholder="Bijvoorbeeld: er komen ook vlaggen bij, en de tekst op de LED-kolom moet 'Welkom' worden."
              />
            ) : null}

            {stap === 'extra' ? <ExtraVelden draft={draft} patch={patch} gekozen={gekozen} uploads={uploads} verlopen={verlopen} /> : null}
          </Question>
        </motion.div>
      </AnimatePresence>
    </Shell>
  )
}

/**
 * Eén treffer, als knop. Hetzelfde voor een evenement en een interne aanvraag; alleen wat erin
 * staat verschilt. Een verlopen deadline staat er meteen bij, zodat het niet pas op het laatste
 * scherm als verrassing komt.
 */
function VondstKnop({ a, actief, onKies }: { a: GevondenAanvraag; actief: boolean; onKies: (a: GevondenAanvraag) => void }) {
  const intern = a.soort === 'intern'
  const meta = intern
    ? [`nodig op ${formatShort(a.deadline)}`]
    : [a.event_datum ? formatShort(a.event_datum) : null, `aangevraagd door ${a.naam}`, describeRequestTypes(a.aanvraag_types, a.anders_tekst)]
  return (
    <button type="button" className="opt vondst" data-vondst="true" aria-pressed={actief} onClick={() => onKies(a)}>
      <span className="opt__label">
        <span className="vondst__event">{intern ? a.omschrijving || 'Interne aanvraag' : a.event}</span>
        <span className="vondst__meta">
          {meta.filter(Boolean).join(' · ')}
          {deadlineVerlopen(a) ? <span className="vondst__verlopen"> · deadline verstreken</span> : null}
        </span>
      </span>
      <Icon name="check" className="opt__check" />
    </button>
  )
}

/** Zoeken op eventnaam, met een korte pauze zodat er niet per aanslag een verzoek uitgaat. */
function Zoeker({ gekozen, onKies, invalid }: { gekozen: GevondenAanvraag | null; onKies: (a: GevondenAanvraag) => void; invalid: boolean }) {
  const [q, setQ] = useState(gekozen?.event ?? '')
  // De uitkomst draagt de zoekterm waar hij bij hoort. Zo kan tijdens het renderen worden afgeleid
  // of we nog zoeken, zonder dat het legen van de lijst zelf weer een render aftrapt.
  const [uitkomst, setUitkomst] = useState<{ term: string; rijen: GevondenAanvraag[] } | null>(null)

  const term = q.trim()
  const teKort = term.length < ZOEK_MIN_TEKENS
  const gezocht = !teKort && uitkomst?.term === term
  const resultaten = gezocht ? (uitkomst?.rijen ?? []) : []
  const zoekend = !teKort && !gezocht

  // Een korte pauze na de laatste toetsaanslag, zodat er niet per letter een verzoek uitgaat.
  useEffect(() => {
    if (term.length < ZOEK_MIN_TEKENS) return
    let afgebroken = false
    const t = window.setTimeout(async () => {
      const rijen = await zoekAanvragen(term)
      if (!afgebroken) setUitkomst({ term, rijen })
    }, 300)
    return () => {
      afgebroken = true
      window.clearTimeout(t)
    }
  }, [term])

  return (
    <div className="zoek">
      <TextField
        id="a-zoek"
        value={q}
        onChange={setQ}
        placeholder="Bijvoorbeeld Zorgcongres"
        maxLength={120}
        invalid={invalid}
        aria-label="Naam van het event"
      />

      {term.length > 0 && teKort ? (
        <p className="hint">Nog even doortypen: vanaf {ZOEK_MIN_TEKENS} letters gaan we zoeken.</p>
      ) : null}
      {zoekend ? <p className="hint">Zoeken…</p> : null}
      {!zoekend && gezocht && resultaten.length === 0 ? (
        <p className="hint">Niets gevonden. Weet je zeker dat de aanvraag via dit formulier is ingediend?</p>
      ) : null}

      <div className="vondsten">
        {resultaten.map((r) => (
          <VondstKnop key={r.id} a={r} actief={gekozen?.id === r.id} onKies={onKies} />
        ))}
      </div>
    </div>
  )
}

/** De interne aanvragen van deze collega, om de juiste uit te kiezen. */
function EigenAanvragen({ naam, gekozen, onKies }: { naam: string; gekozen: GevondenAanvraag | null; onKies: (a: GevondenAanvraag) => void }) {
  // Net als bij het zoeken: de uitkomst weet bij welke naam hij hoort.
  const [uitkomst, setUitkomst] = useState<{ naam: string; rijen: GevondenAanvraag[] } | null>(null)
  const term = naam.trim()
  const geladen = uitkomst?.naam === term
  const rijen = geladen ? (uitkomst?.rijen ?? []) : []

  useEffect(() => {
    let afgebroken = false
    void zoekInterneAanvragen(term).then((r) => {
      if (!afgebroken) setUitkomst({ naam: term, rijen: r })
    })
    return () => {
      afgebroken = true
    }
  }, [term])

  if (!geladen) return <p className="hint">Je aanvragen worden opgezocht…</p>
  if (!rijen.length) {
    return (
      <p className="hint">
        We vinden geen interne aanvragen op naam van {term} uit de afgelopen maanden. Staat je naam precies zoals je hem bij de aanvraag
        invulde? Ga dan een stap terug om hem aan te passen.
      </p>
    )
  }
  return (
    <div className="vondsten">
      {rijen.map((r) => (
        <VondstKnop key={r.id} a={r} actief={gekozen?.id === r.id} onKies={onKies} />
      ))}
    </div>
  )
}

/** De wijzigingen. Leeg laten betekent: laat staan wat er staat - behalve een verlopen deadline. */
function ExtraVelden({
  draft,
  patch,
  gekozen,
  uploads,
  verlopen,
}: {
  draft: Draft
  patch: (p: Partial<Draft>) => void
  gekozen: GevondenAanvraag | null
  uploads: Uploads
  verlopen: boolean
}) {
  const intern = gekozen?.soort === 'intern'
  return (
    <div className="extra">
      {verlopen && gekozen ? (
        <p className="msg msg--verlopen" role="alert">
          <Icon name="alert" />
          <span>
            De deadline van deze aanvraag was <strong>{formatShort(gekozen.deadline)}</strong> en is al voorbij. Kies een nieuwe deadline,
            anders weet Marketing niet wanneer je het nodig hebt.
          </span>
        </p>
      ) : null}

      <section className="extra__blok">
        <h2 className="extra__kop">{verlopen ? 'Wanneer heb je het nu nodig?' : 'Is een datum verschoven?'}</h2>
        {verlopen ? null : <p className="extra__uitleg">Meestal niet, dus de kalender blijft dicht tot je hem nodig hebt.</p>}
        <div className="extra__datums">
          {/* Een interne aanvraag heeft geen event, dus ook geen eventdatum. */}
          {intern ? null : (
            <DatumRegel
              label="Eventdatum"
              huidig={gekozen?.event_datum ?? null}
              waarde={draft.nieuwe_event_datum}
              onKies={(iso) => patch({ nieuwe_event_datum: iso })}
              onWis={() => patch({ nieuwe_event_datum: null })}
            />
          )}
          <DatumRegel
            label="Deadline"
            huidig={gekozen?.deadline ?? null}
            waarde={draft.nieuwe_deadline}
            onKies={(iso) => patch({ nieuwe_deadline: iso })}
            onWis={() => patch({ nieuwe_deadline: null })}
            verplicht={verlopen}
          />
        </div>
      </section>

      <section className="extra__blok">
        <h2 className="extra__kop">Is er materiaal?</h2>
        <p className="extra__uitleg">
          Sleep bestanden hierheen, of verwijs naar een map op de G:-schijf of een link.
          {gekozen?.schijf_locatie ? ` Bij je aanvraag staat nu: ${gekozen.schijf_locatie} — vul je iets anders in, dan geven we dat erbij door.` : ' Alles hier mag leeg blijven.'}
        </p>
        <FileField bijlagen={uploads.bijlagen} onKies={uploads.kies} onVerwijder={uploads.verwijder} />

        <div className="extra__velden">
          <div>
            <span className="extra__label">Locatie op de schijf</span>
            <TextField
              id="a-schijf"
              value={draft.schijf_locatie}
              onChange={(v) => patch({ schijf_locatie: v })}
              placeholder="G:\Events\2026\Zorgcongres"
              maxLength={500}
              focusOnMount={false}
              className="field field--sm"
            />
          </div>
          <div>
            <span className="extra__label">Link naar bestanden</span>
            <TextField
              id="a-link"
              value={draft.link}
              onChange={(v) => patch({ link: v })}
              placeholder="wetransfer.com/..."
              maxLength={500}
              focusOnMount={false}
              className="field field--sm"
            />
          </div>
        </div>
      </section>
    </div>
  )
}

/**
 * Eén datum: laat zien wat er nu staat, en pas als je op "wijzigen" klikt komt de kalender open.
 * Anders staan er twee volle kalenders op een scherm waar niemand ze meestal nodig heeft.
 *
 * Is de datum verplicht te vervangen (een verlopen deadline), dan staat de kalender meteen open en
 * is er geen weg terug naar de oude datum.
 */
function DatumRegel({
  label,
  huidig,
  waarde,
  onKies,
  onWis,
  verplicht = false,
}: {
  label: string
  huidig: string | null
  waarde: string | null
  onKies: (iso: string) => void
  onWis: () => void
  verplicht?: boolean
}) {
  const [open, setOpen] = useState(false)

  if (!verplicht && !open && !waarde) {
    return (
      <div className="datumregel">
        <span className="extra__label">{label}</span>
        <p className="datumregel__nu">
          {huidig ? formatShort(huidig) : 'onbekend'}{' '}
          <button type="button" className="link" onClick={() => setOpen(true)}>
            wijzigen
          </button>
        </p>
      </div>
    )
  }

  return (
    <div className="datumregel">
      <span className="extra__label">Nieuwe {label.toLowerCase()}</span>
      <DateField value={waarde} onChange={onKies} />
      {verplicht ? null : (
        <button
          type="button"
          className="link"
          onClick={() => {
            onWis()
            setOpen(false)
          }}
        >
          toch laten staan op {huidig ? formatShort(huidig) : 'de oude datum'}
        </button>
      )}
    </div>
  )
}

function Gelukt({ result, gekozen, onSluit }: { result: AanvullingResult; gekozen: GevondenAanvraag | null; onSluit: () => void }) {
  return (
    <section className="success">
      <div className="success__content">
        <span className="eyebrow">aanvulling doorgegeven</span>
        <h1 className="success__title swash">Genoteerd.</h1>
        <p className="success__lead">
          Het marketingteam heeft je aanvulling binnen{gekozen?.event ? <> bij de aanvraag voor {gekozen.event}</> : null}. Ze zien hem
          direct bij de rest van wat je eerder doorgaf.
        </p>
        <div className={`success__status success__status--${result.bijgewerkt.length ? 'done' : 'pending'}`} aria-live="polite">
          <Icon name="check" />
          <span>
            {result.bijgewerkt.length
              ? `Meteen aangepast in je aanvraag: ${result.bijgewerkt.join(', ').toLowerCase()}.`
              : 'Het marketingteam leest je toelichting en past aan wat nodig is.'}
          </span>
        </div>
        <div className="success__actions">
          <button type="button" className="btn btn--primary" onClick={onSluit}>
            Terug naar het begin
            <Icon name="arrow-right" className="arrow" />
          </button>
        </div>
      </div>
    </section>
  )
}
