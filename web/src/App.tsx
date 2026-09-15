import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { submitPayloadSchema, type SubmitResult } from '../../shared/aanvraag-schema'
import { DESIGN_MODES, REQUEST_TYPES, type DesignMode, type RequestTypeKey } from '../../shared/request-types'
import { ChoiceList, LETTERS } from './components/ChoiceList'
import { DateField } from './components/DateField'
import { NameCombobox } from './components/NameCombobox'
import { PrimaryAction, Question } from './components/Question'
import { Review } from './components/Review'
import { Shell } from './components/Shell'
import { Start } from './components/Start'
import { Success } from './components/Success'
import { TextArea, TextField } from './components/TextField'
import { COLLEGAS_FALLBACK } from './data/collegas.fallback'
import { ApiError, fetchCollegas, submitAanvraag } from './lib/api'
import { clearDraft, draftHasContent, loadDraft, saveDraft } from './lib/storage'
import { emptyDraft, type Draft } from './state'
import { Aanvulling } from './Aanvulling'
import { STEPS } from './steps'

type Screen =
  | { kind: 'start' }
  | { kind: 'step'; index: number }
  | { kind: 'review' }
  | { kind: 'success'; result: SubmitResult; draft: Draft }
  /** De tweede flow: iets nasturen op een aanvraag die al loopt. Heeft zijn eigen state. */
  | { kind: 'aanvulling' }

const pad = (n: number) => String(n).padStart(2, '0')

function isTypingTarget(el: EventTarget | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false
  return el.matches('input, textarea, select, [contenteditable="true"]')
}

export default function App() {
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [screen, setScreen] = useState<Screen>({ kind: 'start' })
  const [dir, setDir] = useState<1 | -1>(1)
  const [error, setError] = useState<string | null>(null)
  const [errorNonce, setErrorNonce] = useState(0)
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [collegas, setCollegas] = useState<string[]>(COLLEGAS_FALLBACK)
  const [resume, setResume] = useState<{ draft: Draft; step: number } | null>(() => {
    const s = loadDraft()
    return s && draftHasContent(s.draft) ? { draft: s.draft, step: s.step } : null
  })
  const reduced = useReducedMotion()
  const clientRequestId = useRef<string>(crypto.randomUUID())
  const startedAt = useRef<string>(new Date().toISOString())

  useEffect(() => {
    fetchCollegas(COLLEGAS_FALLBACK).then(setCollegas)
  }, [])

  // Autosave zolang de gebruiker in het formulier zit.
  useEffect(() => {
    if (screen.kind === 'step') saveDraft(draft, screen.index)
    if (screen.kind === 'review') saveDraft(draft, STEPS.length - 1)
  }, [draft, screen])

  const patch = useCallback((p: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...p }))
    setError(null)
  }, [])

  const go = useCallback((next: Screen, direction: 1 | -1) => {
    // Toetsaanslagen tijdens de overgang mogen niet in het oude veld belanden.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    setDir(direction)
    setError(null)
    setScreen(next)
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [])

  const stepIndex = screen.kind === 'step' ? screen.index : screen.kind === 'review' ? STEPS.length : -1
  const step = screen.kind === 'step' ? STEPS[screen.index] : null

  const next = useCallback(() => {
    if (screen.kind !== 'step') return
    const msg = STEPS[screen.index].validate(draft)
    if (msg) {
      setError(msg)
      setErrorNonce((n) => n + 1)
      return
    }
    if (screen.index + 1 < STEPS.length) go({ kind: 'step', index: screen.index + 1 }, 1)
    else go({ kind: 'review' }, 1)
  }, [screen, draft, go])

  const prev = useCallback(() => {
    if (screen.kind === 'step') {
      if (screen.index === 0) go({ kind: 'start' }, -1)
      else go({ kind: 'step', index: screen.index - 1 }, -1)
    } else if (screen.kind === 'review') {
      go({ kind: 'step', index: STEPS.length - 1 }, -1)
    }
  }, [screen, go])

  const focusPrimary = useCallback(() => {
    window.setTimeout(() => document.querySelector<HTMLButtonElement>('[data-primary-action]')?.focus({ preventScroll: true }), 30)
  }, [])

  const toggleType = useCallback(
    (key: string) => {
      const k = key as RequestTypeKey
      setDraft((d) => {
        const has = d.aanvraag_types.includes(k)
        const list = has ? d.aanvraag_types.filter((x) => x !== k) : [...d.aanvraag_types, k]
        // Vaste volgorde zoals in de lijst, zodat de Asana-titel voorspelbaar is.
        const ordered = REQUEST_TYPES.map((t) => t.key).filter((x) => list.includes(x))
        return { ...d, aanvraag_types: ordered, anders_tekst: ordered.includes('anders') ? d.anders_tekst : '' }
      })
      setError(null)
      if (k === 'anders') {
        window.setTimeout(() => {
          const el = document.querySelector<HTMLInputElement>('[data-other-input]')
          el?.focus({ preventScroll: true })
          el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }, 30)
      }
    },
    [],
  )

  const submit = useCallback(async () => {
    if (busy) return
    setSubmitError(null)
    const parsed = submitPayloadSchema.safeParse({
      aanvraag: {
        naam: draft.naam,
        event: draft.event,
        event_datum: draft.event_datum ?? '',
        deadline: draft.deadline ?? '',
        website: draft.website,
        schijf_locatie: draft.schijf_locatie,
        aanvraag_types: draft.aanvraag_types,
        anders_tekst: draft.anders_tekst,
        design_modus: draft.design_modus ?? undefined,
        omschrijving: draft.omschrijving,
      },
      client_request_id: clientRequestId.current,
      started_at: startedAt.current,
      website_confirm: '',
    })
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const field = String(issue?.path?.[1] ?? '')
      const idx = STEPS.findIndex((s) => s.id === field || (field === 'anders_tekst' && s.id === 'aanvraag_types'))
      if (idx >= 0) {
        go({ kind: 'step', index: idx }, -1)
        setError(issue?.message ?? 'Controleer dit veld.')
        setErrorNonce((n) => n + 1)
      } else {
        setSubmitError(issue?.message ?? 'Er klopt iets niet in de aanvraag.')
      }
      return
    }
    setBusy(true)
    try {
      const result = await submitAanvraag(parsed.data)
      clearDraft()
      const done = draft
      setDraft(emptyDraft())
      go({ kind: 'success', result, draft: done }, 1)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Verzenden is niet gelukt. Controleer je verbinding en probeer het opnieuw.'
      setSubmitError(msg)
    } finally {
      setBusy(false)
    }
  }, [busy, draft, go])

  const restart = useCallback(() => {
    clientRequestId.current = crypto.randomUUID()
    startedAt.current = new Date().toISOString()
    setDraft(emptyDraft())
    setSubmitError(null)
    setResume(null)
    go({ kind: 'start' }, -1)
  }, [go])

  // Toetsenbord: Enter = volgende, letters = opties, pijltjes = navigeren buiten invoervelden.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.altKey) return
      const target = e.target
      const typing = isTypingTarget(target)

      if (screen.kind === 'start') {
        // Staat de focus op de aanvullen-link, dan hoort Enter díe te volgen, niet het formulier te starten.
        if (e.key === 'Enter' && !typing && !(target instanceof HTMLElement && target.closest('.link'))) {
          e.preventDefault()
          go({ kind: 'step', index: 0 }, 1)
        }
        return
      }

      // De aanvulling-flow luistert zelf; hier niets doen.
      if (screen.kind === 'aanvulling') return

      if (screen.kind === 'review') {
        if (e.key === 'Enter' && !typing && !(target instanceof HTMLAnchorElement)) {
          e.preventDefault()
          void submit()
        }
        return
      }

      if (screen.kind !== 'step') return
      const kind = STEPS[screen.index].kind

      if (e.key === 'Enter') {
        // Open combobox met een actieve optie: laat Headless UI die kiezen. Zonder actieve optie valideren we gewoon.
        if (target instanceof HTMLElement && target.getAttribute('aria-expanded') === 'true' && target.getAttribute('aria-activedescendant')) return
        // Kalender: Enter op een dag kiest alleen die dag.
        if (target instanceof HTMLElement && target.matches('.date__day')) return
        // Textarea: Shift+Enter is een nieuwe regel, Enter gaat door.
        if (target instanceof HTMLTextAreaElement && e.shiftKey) return
        // Knoppen (behalve de primaire) doen hun eigen ding.
        if (target instanceof HTMLButtonElement && !target.hasAttribute('data-primary-action')) return
        e.preventDefault()
        next()
        return
      }

      if ((kind === 'multi' || kind === 'single') && !typing && !e.metaKey && !e.ctrlKey) {
        const letter = e.key.toUpperCase()
        const i = LETTERS.indexOf(letter)
        if (letter.length === 1 && i >= 0) {
          const options = kind === 'multi' ? REQUEST_TYPES : DESIGN_MODES
          const opt = options[i]
          if (opt) {
            e.preventDefault()
            if (kind === 'multi') toggleType(opt.key)
            else patch({ design_modus: opt.key as DesignMode })
          }
          return
        }
      }

      if (!typing && !(target instanceof HTMLElement && target.closest('.date__grid'))) {
        if (e.key === 'ArrowDown' || e.key === 'PageDown') {
          e.preventDefault()
          next()
        } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
          e.preventDefault()
          prev()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [screen, next, prev, go, submit, toggleType, patch])

  const variants = useMemo(
    () => ({
      initial: (d: number) => ({ opacity: 0, y: reduced ? 0 : d > 0 ? 36 : -36 }),
      animate: { opacity: 1, y: 0, transition: { duration: reduced ? 0 : 0.4, ease: [0.22, 1, 0.36, 1] as const } },
      exit: (d: number) => ({ opacity: 0, y: reduced ? 0 : d > 0 ? -28 : 28, transition: { duration: reduced ? 0 : 0.22, ease: 'easeIn' as const } }),
    }),
    [reduced],
  )

  if (screen.kind === 'start') {
    return (
      <>
        {resume ? (
          <div className="resume" role="status">
            <span>Verder waar je gebleven was?</span>
            <span className="resume__actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => {
                  setDraft(resume.draft)
                  setResume(null)
                  go({ kind: 'step', index: Math.min(resume.step, STEPS.length - 1) }, 1)
                }}
              >
                Verder
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  clearDraft()
                  setResume(null)
                }}
              >
                Opnieuw
              </button>
            </span>
          </div>
        ) : null}
        <Start onStart={() => go({ kind: 'step', index: 0 }, 1)} onAanvullen={() => go({ kind: 'aanvulling' }, 1)} stepCount={STEPS.length} />
      </>
    )
  }

  if (screen.kind === 'aanvulling') {
    return <Aanvulling collegas={collegas} onSluit={() => go({ kind: 'start' }, -1)} />
  }

  if (screen.kind === 'success') {
    return <Success result={screen.result} website={screen.draft.website} naam={screen.draft.naam} onRestart={restart} />
  }

  const progress = stepIndex / STEPS.length
  const counter = screen.kind === 'review' ? `${pad(STEPS.length)} / ${pad(STEPS.length)}` : `${pad(stepIndex + 1)} / ${pad(STEPS.length)}`
  const screenKey = screen.kind === 'review' ? 'review' : `step-${screen.index}`

  return (
    <Shell progress={progress} counter={counter} canPrev onPrev={prev} canNext={screen.kind === 'step'} onNext={next}>
      <AnimatePresence mode="wait" custom={dir} initial={false}>
        <motion.div key={screenKey} custom={dir} variants={variants} initial="initial" animate="animate" exit="exit">
          {screen.kind === 'review' ? (
            <Review draft={draft} onEdit={(i) => go({ kind: 'step', index: i }, -1)} onSubmit={() => void submit()} busy={busy} error={submitError} titleId="q-review" />
          ) : step ? (
            <Question
              number={screen.index + 1}
              title={step.title}
              help={step.help}
              error={error}
              errorNonce={errorNonce}
              warning={step.warn?.(draft) ?? null}
              goed={step.goed?.(draft) ?? null}
              titleId={`q-${step.id}`}
              footer={<PrimaryAction label={screen.index === STEPS.length - 1 ? 'Naar overzicht' : 'Volgende'} onClick={next} />}
            >
              {step.kind === 'naam' ? (
                <NameCombobox id="f-naam" value={draft.naam} onChange={(v) => patch({ naam: v })} names={collegas} invalid={Boolean(error)} />
              ) : null}
              {step.kind === 'text' && step.id === 'event' ? (
                <TextField id="f-event" value={draft.event} onChange={(v) => patch({ event: v })} placeholder="Bijvoorbeeld Zorgcongres 2026" maxLength={120} invalid={Boolean(error)} aria-labelledby={`q-${step.id}`} />
              ) : null}
              {step.kind === 'text' && step.id === 'schijf_locatie' ? (
                <TextField id="f-schijf" value={draft.schijf_locatie} onChange={(v) => patch({ schijf_locatie: v })} placeholder="G:\Events\2026\Zorgcongres" maxLength={500} invalid={Boolean(error)} aria-labelledby={`q-${step.id}`} />
              ) : null}
              {step.kind === 'url' ? (
                <TextField id="f-website" type="text" inputMode="url" value={draft.website} onChange={(v) => patch({ website: v })} placeholder="www.event.nl" invalid={Boolean(error)} aria-labelledby={`q-${step.id}`} />
              ) : null}
              {step.kind === 'date' && step.id === 'event_datum' ? (
                <DateField value={draft.event_datum} onChange={(v) => patch({ event_datum: v, deadline: draft.deadline && draft.deadline > v ? null : draft.deadline })} onPicked={focusPrimary} />
              ) : null}
              {step.kind === 'date' && step.id === 'deadline' ? (
                <DateField value={draft.deadline} onChange={(v) => patch({ deadline: v })} max={draft.event_datum ?? undefined} onPicked={focusPrimary} />
              ) : null}
              {step.kind === 'multi' ? (
                <ChoiceList
                  multi
                  options={REQUEST_TYPES}
                  value={draft.aanvraag_types}
                  onToggle={toggleType}
                  otherKey="anders"
                  otherValue={draft.anders_tekst}
                  onOtherChange={(v) => patch({ anders_tekst: v })}
                  otherInvalid={Boolean(error) && !draft.anders_tekst.trim()}
                />
              ) : null}
              {step.kind === 'single' ? (
                <ChoiceList cards options={DESIGN_MODES} value={draft.design_modus} onToggle={(k) => patch({ design_modus: k as DesignMode })} />
              ) : null}
              {step.kind === 'textarea' ? (
                <>
                  <TextArea id="f-omschrijving" value={draft.omschrijving} onChange={(v) => patch({ omschrijving: v })} maxLength={3000} placeholder="Bijvoorbeeld: tekst voor het scherm, gewenste sfeer, voorbeelden van eerdere edities…" />
                  <span className="hint hint--kbd">
                    <kbd>Shift</kbd> + <kbd>Enter</kbd> voor een nieuwe regel
                  </span>
                </>
              ) : null}
            </Question>
          ) : null}
        </motion.div>
      </AnimatePresence>
      <span className="sr-only" aria-live="polite">
        {step ? `Vraag ${stepIndex + 1} van ${STEPS.length}: ${step.title}` : 'Overzicht van je aanvraag'}
      </span>
    </Shell>
  )
}
