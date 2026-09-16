import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AanvullingResult, GevondenAanvraag } from '../../shared/aanvulling-schema'
import { ZOEK_MIN_TEKENS } from '../../shared/aanvulling-schema'
import { REQUEST_TYPES, type RequestTypeKey, describeRequestTypes } from '../../shared/request-types'
import { ChoiceList } from './components/ChoiceList'
import { FileField } from './components/FileField'
import { DateField } from './components/DateField'
import { Icon } from './components/Icon'
import { NameCombobox } from './components/NameCombobox'
import { PrimaryAction, Question } from './components/Question'
import { Shell } from './components/Shell'
import { TextArea, TextField } from './components/TextField'
import { ApiError, verstuurAanvulling, zoekAanvragen } from './lib/api'
import { useBijlagen, type Uploads } from './lib/uploads'
import { formatShort } from './lib/dates'

/**
 * Tweede, korte flow: iets nasturen op een aanvraag die al loopt.
 *
 * Bewust géén gebruik van de STEPS-machinerie van het hoofdformulier. Die koppelt elke stap aan een
 * vaste sleutel in `Draft`, en dat zou hier verbogen moeten worden voor vier vragen waarvan de
 * eerste (zoeken) een heel eigen scherm heeft. De losse bouwstenen — Shell, Question, ChoiceList —
 * worden wel gedeeld, dus het oogt en werkt hetzelfde.
 */

const STAPPEN = ['zoek', 'naam', 'toelichting', 'extra'] as const
type Stap = (typeof STAPPEN)[number]

interface Props {
  collegas: string[]
  onSluit: () => void
}

interface Draft {
  naam: string
  toelichting: string
  extra_types: RequestTypeKey[]
  anders_tekst: string
  nieuwe_event_datum: string | null
  nieuwe_deadline: string | null
  schijf_locatie: string
  link: string
}

const leeg: Draft = {
  naam: '',
  toelichting: '',
  extra_types: [],
  anders_tekst: '',
  nieuwe_event_datum: null,
  nieuwe_deadline: null,
  schijf_locatie: '',
  link: '',
}

export function Aanvulling({ collegas, onSluit }: Props) {
  const [index, setIndex] = useState(0)
  const [dir, setDir] = useState<1 | -1>(1)
  const [gekozen, setGekozen] = useState<GevondenAanvraag | null>(null)
  const [draft, setDraft] = useState<Draft>(leeg)
  const [error, setError] = useState<string | null>(null)
  const [errorNonce, setErrorNonce] = useState(0)
  const [busy, setBusy] = useState(false)
  const [klaar, setKlaar] = useState<AanvullingResult | null>(null)
  const uploads = useBijlagen('aanvulling')
  const clientRequestId = useRef(crypto.randomUUID())
  const startedAt = useRef(new Date().toISOString())

  const stap: Stap = STAPPEN[index]
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }))

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
    if (stap === 'zoek') return gekozen ? null : 'Kies de aanvraag waar het over gaat.'
    if (stap === 'naam') return draft.naam ? null : 'Kies je naam uit de lijst.'
    if (stap === 'toelichting') {
      const t = draft.toelichting.trim()
      if (t.length < 5) return 'Vertel kort wat er moet veranderen.'
      if (t.length > 3000) return 'Houd het bij maximaal 3000 tekens.'
      return null
    }
    // Laatste stap: alles is optioneel, behalve dat wat je invult moet kloppen.
    if (uploads.bezig) return 'Je bestanden worden nog geüpload — nog heel even.'
    if (draft.extra_types.includes('anders') && !draft.anders_tekst.trim()) return 'Vul in wat je bij "Anders" bedoelt.'
    const event = draft.nieuwe_event_datum ?? gekozen?.event_datum ?? ''
    const deadline = draft.nieuwe_deadline ?? gekozen?.deadline ?? ''
    if (event && deadline && deadline > event) return 'De deadline kan niet na het event liggen.'
    return null
  }

  const volgende = () => {
    const f = valideer()
    if (f) return fout(f)
    if (index < STAPPEN.length - 1) ga(index + 1, 1)
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
          extra_types: draft.extra_types,
          anders_tekst: draft.anders_tekst,
          nieuwe_event_datum: draft.nieuwe_event_datum,
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
      if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey) return
      const el = document.activeElement as HTMLElement | null
      if (el?.tagName === 'TEXTAREA') return
      // De namenlijst en de zoeklijst doen zelf iets met Enter.
      if (el?.getAttribute('role') === 'combobox' || el?.dataset.vondst) return
      // "Anders, namelijk…": Enter bevestigt de tekst en legt de focus op de knop. Zonder dit zou
      // Enter tijdens het typen de hele aanvulling versturen.
      if (el?.hasAttribute('data-other-input')) {
        e.preventDefault()
        window.setTimeout(() => document.querySelector<HTMLButtonElement>('[data-primary-action]')?.focus({ preventScroll: true }), 30)
        return
      }
      e.preventDefault()
      volgende()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (klaar) return <Gelukt result={klaar} gekozen={gekozen} onSluit={onSluit} />

  const titels: Record<Stap, string> = {
    zoek: 'Bij welk event hoort het?',
    naam: 'Wie ben je?',
    toelichting: 'Wat moet erbij of anders?',
    extra: 'Verandert er nog iets aan de aanvraag?',
  }
  const hulp: Record<Stap, string | undefined> = {
    zoek: 'Typ een deel van de eventnaam. Je ziet de aanvragen van de afgelopen maanden.',
    naam: 'Dan weet Marketing wie deze aanvulling stuurde.',
    toelichting: 'Extra wensen, aanvullende informatie of feedback op het concept. Het marketingteam krijgt er meteen bericht van.',
    extra: 'Alles hieronder mag je overslaan. Wat je leeg laat, blijft staan zoals het was.',
  }

  return (
    <Shell
      progress={(index + 1) / (STAPPEN.length + 1)}
      counter={`${index + 1} / ${STAPPEN.length}`}
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
                label={index === STAPPEN.length - 1 ? 'Versturen' : 'Volgende'}
                onClick={volgende}
                busy={busy}
                hint={stap === 'toelichting' ? null : 'Enter'}
              />
            }
          >
            {stap === 'zoek' ? <Zoeker gekozen={gekozen} onKies={setGekozen} invalid={Boolean(error)} /> : null}

            {stap === 'naam' ? (
              <NameCombobox id="a-naam" value={draft.naam} onChange={(v) => patch({ naam: v })} names={collegas} invalid={Boolean(error)} />
            ) : null}

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

            {stap === 'extra' ? <ExtraVelden draft={draft} patch={patch} gekozen={gekozen} uploads={uploads} invalidAnders={Boolean(error)} /> : null}
          </Question>
        </motion.div>
      </AnimatePresence>
    </Shell>
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
        {resultaten.map((r) => {
          const actief = gekozen?.id === r.id
          return (
            <button
              key={r.id}
              type="button"
              className="opt vondst"
              data-vondst="true"
              aria-pressed={actief}
              onClick={() => onKies(r)}
            >
              <span className="opt__label">
                <span className="vondst__event">{r.event}</span>
                <span className="vondst__meta">
                  {formatShort(r.event_datum)} · aangevraagd door {r.naam} · {describeRequestTypes(r.aanvraag_types, r.anders_tekst)}
                </span>
              </span>
              <Icon name="check" className="opt__check" />
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** De optionele wijzigingen. Leeg laten betekent: laat staan wat er staat. */
function ExtraVelden({
  draft,
  patch,
  gekozen,
  uploads,
  invalidAnders,
}: {
  draft: Draft
  patch: (p: Partial<Draft>) => void
  gekozen: GevondenAanvraag | null
  uploads: Uploads
  invalidAnders: boolean
}) {
  const alAangevraagd = useMemo(() => new Set(gekozen?.aanvraag_types ?? []), [gekozen])
  // Wat al is aangevraagd hoeft niet nog een keer gekozen te worden.
  const opties = REQUEST_TYPES.filter((t) => !alAangevraagd.has(t.key)).map((t) => ({ key: t.key, label: t.label }))

  const toggle = (key: string) => {
    const k = key as RequestTypeKey
    patch({ extra_types: draft.extra_types.includes(k) ? draft.extra_types.filter((x) => x !== k) : [...draft.extra_types, k] })
    // Net als in het hoofdformulier: kies je "Anders", dan sta je meteen in het tekstveld.
    if (k === 'anders' && !draft.extra_types.includes(k)) {
      window.setTimeout(() => document.querySelector<HTMLInputElement>('[data-other-input]')?.focus({ preventScroll: true }), 30)
    }
  }

  return (
    <div className="extra">
      {opties.length ? (
        <section className="extra__blok">
          <h2 className="extra__kop">Komt er iets bij?</h2>
          <p className="extra__uitleg">
            Al aangevraagd: {describeRequestTypes(gekozen?.aanvraag_types ?? [], gekozen?.anders_tekst ?? '')}. Wat je hier kiest komt erbij;
            er verdwijnt niets.
          </p>
          <ChoiceList
            multi
            options={opties}
            value={draft.extra_types}
            onToggle={toggle}
            otherKey="anders"
            otherValue={draft.anders_tekst}
            onOtherChange={(v) => patch({ anders_tekst: v })}
            otherInvalid={invalidAnders && draft.extra_types.includes('anders') && !draft.anders_tekst.trim()}
          />
        </section>
      ) : null}

      <section className="extra__blok">
        <h2 className="extra__kop">Is een datum verschoven?</h2>
        <p className="extra__uitleg">Meestal niet, dus de kalender blijft dicht tot je hem nodig hebt.</p>
        <div className="extra__datums">
          <DatumRegel
            label="Eventdatum"
            huidig={gekozen?.event_datum ?? null}
            waarde={draft.nieuwe_event_datum}
            onKies={(iso) => patch({ nieuwe_event_datum: iso })}
            onWis={() => patch({ nieuwe_event_datum: null })}
          />
          <DatumRegel
            label="Deadline"
            huidig={gekozen?.deadline ?? null}
            waarde={draft.nieuwe_deadline}
            onKies={(iso) => patch({ nieuwe_deadline: iso })}
            onWis={() => patch({ nieuwe_deadline: null })}
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
 */
function DatumRegel({
  label,
  huidig,
  waarde,
  onKies,
  onWis,
}: {
  label: string
  huidig: string | null
  waarde: string | null
  onKies: (iso: string) => void
  onWis: () => void
}) {
  const [open, setOpen] = useState(false)

  if (!open && !waarde) {
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
