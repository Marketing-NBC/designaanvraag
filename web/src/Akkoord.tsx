import { useEffect, useState } from 'react'
import type { AkkoordInfo, AkkoordResultaat } from '../../shared/akkoord'
import { describeRequestTypes } from '../../shared/request-types'
import { Icon } from './components/Icon'
import { NameCombobox } from './components/NameCombobox'
import { PrimaryAction, Question } from './components/Question'
import { Shell } from './components/Shell'
import { ApiError, geefAkkoord, haalAkkoordInfo } from './lib/api'
import { formatLong } from './lib/dates'
import { NIET_IN_LIJST_AKKOORD, naamUitLijst } from './state'

interface Props {
  /** Het id uit `?akkoord=` in de link van de opleveringsmail of een herinnering. */
  aanvraagId: string
  collegas: string[]
  onSluit: () => void
  /** Toch iets anders? Dan naar het feedbackscherm met deze aanvraag gekozen. */
  onFeedback: () => void
}

/**
 * Akkoord geven op een oplevering. Eén vraag: wie ben je, en dan de knop. Alleen de aanvrager kan
 * akkoord geven; wie anders de mail kreeg, kan hier door naar feedback geven.
 *
 * Dat het een scherm met een knop is en geen link die meteen akkoord geeft, is met opzet: de
 * virusscanner van Outlook opent elke link in een mail om hem te controleren. Een link die bij het
 * openen al iets doet, zou dan vanzelf akkoord geven.
 */
export function Akkoord({ aanvraagId, collegas, onSluit, onFeedback }: Props) {
  const [info, setInfo] = useState<AkkoordInfo | null | 'laden'>('laden')
  const [laadFout, setLaadFout] = useState<string | null>(null)
  const [naam, setNaam] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [errorNonce, setErrorNonce] = useState(0)
  const [busy, setBusy] = useState(false)
  const [klaar, setKlaar] = useState<AkkoordResultaat | null>(null)

  useEffect(() => {
    let afgebroken = false
    haalAkkoordInfo(aanvraagId)
      .then((i) => { if (!afgebroken) setInfo(i) })
      .catch((e) => {
        if (afgebroken) return
        setInfo(null)
        setLaadFout(e instanceof ApiError ? e.message : 'Ophalen mislukt.')
      })
    return () => { afgebroken = true }
  }, [aanvraagId])

  // Enter geeft akkoord, behalve als de namenlijst open staat met een naam aangewezen: dan kiest
  // Enter die naam. Op een andere knop doet Enter wat die knop doet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.defaultPrevented) return
      if (info === 'laden' || !info || info.status !== 'open' || klaar) return
      const el = document.activeElement as HTMLElement | null
      if (el?.getAttribute('role') === 'combobox' && el.getAttribute('aria-activedescendant')) return
      if (el?.tagName === 'BUTTON' && !el.hasAttribute('data-primary-action')) return
      e.preventDefault()
      void verstuur()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function verstuur() {
    if (busy) return
    if (naam.trim().length < 2) {
      setError('Vul je naam in.')
      setErrorNonce((n) => n + 1)
      return
    }
    // Alleen collega's uit de lijst; is de lijst niet geladen, dan houdt de function het tegen.
    const lijstnaam = collegas.length ? naamUitLijst(naam, collegas) : naam.trim()
    if (!lijstnaam) {
      setError(NIET_IN_LIJST_AKKOORD)
      setErrorNonce((n) => n + 1)
      return
    }
    // Alleen de aanvrager; de function controleert het ook.
    if (info && info !== 'laden' && info.aanvrager && lijstnaam.trim().toLowerCase() !== info.aanvrager.trim().toLowerCase()) {
      setError(`Alleen ${info.aanvrager}, die de aanvraag deed, kan akkoord geven. Moet er iets anders? Geef dan feedback.`)
      setErrorNonce((n) => n + 1)
      return
    }
    setBusy(true)
    setError(null)
    try {
      setKlaar(await geefAkkoord(aanvraagId, lijstnaam))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Akkoord geven is niet gelukt. Controleer je verbinding en probeer het opnieuw.')
      setErrorNonce((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  if (klaar) return <Gelukt resultaat={klaar} onSluit={onSluit} />

  if (info === 'laden') {
    return (
      <Shell progress={0} counter="" canPrev onPrev={onSluit} canNext={false} onNext={() => {}}>
        <p className="hint" aria-live="polite">Je aanvraag wordt opgezocht…</p>
      </Shell>
    )
  }

  if (!info || info.status !== 'open') {
    const titel = !info ? 'Deze aanvraag is niet meer te vinden'
      : info.status === 'akkoord' ? 'Hier is al akkoord op gegeven'
      : 'Er staat nog niets klaar'
    const uitleg = !info ? (laadFout ?? 'De aanvraag staat niet meer open bij Marketing. Twijfel je? Mail dan even naar het marketingteam.')
      : info.status === 'akkoord'
        ? `${info.akkoord_door ?? 'Een collega'} gaf akkoord${info.versie && info.versie > 1 ? ` op versie ${info.versie}` : ''}${info.akkoord_op ? ` op ${formatLong(info.akkoord_op.slice(0, 10))}` : ''}. Je hoeft niets meer te doen.`
        : 'Marketing heeft bij deze aanvraag nog niets opgeleverd. Zodra het ontwerp klaar is, krijg je een mail met een knop om akkoord te geven.'
    return (
      <Shell progress={1} counter="" canPrev onPrev={onSluit} canNext={false} onNext={() => {}}>
        <Question
          number={1}
          title={titel}
          help={uitleg}
          titleId="akkoord-status"
          footer={<PrimaryAction label="Naar het begin" onClick={onSluit} hint={null} />}
        >
          {info?.status === 'akkoord' ? (
            <button type="button" className="link" onClick={onFeedback}>Toch iets anders? Geef feedback</button>
          ) : null}
        </Question>
      </Shell>
    )
  }

  const wat = info.soort === 'intern'
    ? (info.omschrijving || 'je interne aanvraag')
    : [info.event, info.event_datum ? formatLong(info.event_datum) : null].filter(Boolean).join(', ')

  return (
    <Shell progress={0.5} counter="1 / 1" canPrev onPrev={onSluit} canNext onNext={() => void verstuur()}>
      <Question
        number={1}
        title="Akkoord geven"
        help={`Is het ontwerp goed? Akkoord geven kan alleen ${info.aanvrager}, die de aanvraag deed. Marketing ziet het meteen, en de herinneringen stoppen.`}
        error={error}
        errorNonce={errorNonce}
        titleId="akkoord-vraag"
        footer={<PrimaryAction label="Akkoord geven" onClick={() => void verstuur()} busy={busy} hint="Enter" />}
      >
        <div className="akkoord__wat">
          <span><strong>{info.versie && info.versie > 1 ? `Versie ${info.versie}` : 'Het ontwerp'}</strong> voor {wat}</span>
          {info.soort !== 'intern' && info.aanvraag_types.length ? (
            <span>{describeRequestTypes(info.aanvraag_types, info.anders_tekst)}</span>
          ) : null}
          {info.verstuurd_op ? <span className="hint">Opgeleverd op {formatLong(info.verstuurd_op.slice(0, 10))}</span> : null}
        </div>
        <NameCombobox
          id="akkoord-naam"
          value={naam}
          onChange={(v) => { setNaam(v); setError(null) }}
          names={collegas}
          invalid={Boolean(error)}
          onEnter={() => void verstuur()}
          nieuwHint="Deze naam staat niet in de lijst. Vraag Marketing om je toe te voegen."
        />
        <p className="hint" style={{ marginTop: 16 }}>
          Moet er toch iets anders?{' '}
          <button type="button" className="link" onClick={onFeedback}>Geef dan feedback</button>
        </p>
      </Question>
    </Shell>
  )
}

function Gelukt({ resultaat, onSluit }: { resultaat: AkkoordResultaat; onSluit: () => void }) {
  return (
    <section className="success">
      <div className="success__content">
        <span className="eyebrow">{resultaat.al ? 'al akkoord' : 'akkoord gegeven'}</span>
        <h1 className="success__title swash">{resultaat.al ? 'Was al geregeld.' : 'Dank je wel.'}</h1>
        <p className="success__lead">
          {resultaat.al
            ? <>{resultaat.door} gaf al akkoord{resultaat.versie > 1 ? ` op versie ${resultaat.versie}` : ''}. Je hoeft niets meer te doen.</>
            : <>Marketing weet dat het ontwerp goed is. Je krijgt hierover geen herinneringen meer.</>}
        </p>
        <div className="success__status success__status--done" aria-live="polite">
          <Icon name="check" />
          <span>{resultaat.al ? 'De aanvraag is afgerond.' : `Akkoord van ${resultaat.door} doorgegeven.`}</span>
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
