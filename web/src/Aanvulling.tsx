import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { AanvullingResult, GevondenAanvraag } from '../../shared/aanvulling-schema'
import { ZOEK_MIN_TEKENS } from '../../shared/aanvulling-schema'
import { SOORT_KEUZES, describeRequestTypes, vraagtOmMenu, type Soort } from '../../shared/request-types'
import { ChoiceList, LETTERS } from './components/ChoiceList'
import { FileField } from './components/FileField'
import { DateField } from './components/DateField'
import { Icon } from './components/Icon'
import { MenuPicker } from './components/MenuPicker'
import { NameCombobox } from './components/NameCombobox'
import { PrimaryAction, Question } from './components/Question'
import { Shell } from './components/Shell'
import { TextArea, TextField } from './components/TextField'
import { ApiError, haalAanvraag, verstuurAanvulling, zoekAanvragen, zoekInterneAanvragen } from './lib/api'
import { useBijlagen } from './lib/uploads'
import { PAKKETTEN_OP_SCHERM, aantalGerechten, leegMenu, naarInhoud, naarTekst, uitPakket, type MenuKeuze } from './lib/menu'
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
 *
 * Via de knop "Feedback geven" in de opleveringsmail staat de aanvraag al vast (`vooraf`). Dan
 * vallen het kiezen en zoeken weg: je naam, je feedback, en wat er verder verandert.
 *
 * Hoort er een menukaart of menuscherm bij de aanvraag, dan staat onder de bijlagen "Menu
 * aanpassen". Dat opent hetzelfde menuscherm als in het formulier, met het menu van toen erin,
 * en voegt een stap toe na de toelichting.
 */

type Stap = 'soort' | 'zoek' | 'naam' | 'kies' | 'toelichting' | 'menu' | 'extra'

const STAPPEN: Record<Soort | 'feedback', readonly Stap[]> = {
  evenement: ['soort', 'zoek', 'naam', 'toelichting', 'extra'],
  intern: ['soort', 'naam', 'kies', 'toelichting', 'extra'],
  feedback: ['naam', 'toelichting', 'extra'],
}

interface Props {
  collegas: string[]
  /** Id van een aanvraag die al gekozen is: de feedbacklink uit de opleveringsmail. */
  vooraf?: string | null
  onSluit: () => void
}

interface Draft {
  naam: string
  toelichting: string
  nieuwe_event_datum: string | null
  nieuwe_deadline: string | null
  schijf_locatie: string
  link: string
  /** Het aangepaste menu. Null = het menu blijft zoals het bij de aanvraag staat. */
  menu: MenuKeuze | null
}

const leeg: Draft = {
  naam: '',
  toelichting: '',
  nieuwe_event_datum: null,
  nieuwe_deadline: null,
  schijf_locatie: '',
  link: '',
  menu: null,
}

/** Het menu van de aanvraag als keuze voor het menuscherm: wat er stond, of het pakket van toen. */
function menuVan(m: GevondenAanvraag['menu']): MenuKeuze {
  if (m?.inhoud) return { pakket: m.inhoud.pakket, secties: m.inhoud.secties.map((s) => ({ kop: s.kop, gerechten: s.gerechten.map((g) => ({ ...g })) })) }
  if (m?.pakket) return uitPakket(m.pakket)
  return leegMenu()
}

/** Is de deadline van deze aanvraag al voorbij? Dan moet er een nieuwe bij. Zonder deadline niet. */
function deadlineVerlopen(a: Pick<GevondenAanvraag, 'deadline'> | null): boolean {
  return Boolean(a?.deadline && isBeforeToday(a.deadline))
}

export function Aanvulling({ collegas, vooraf = null, onSluit }: Props) {
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
  // Via de feedbacklink: eerst de aanvraag ophalen. Lukt dat niet, dan gewoon zelf zoeken.
  const [feedback, setFeedback] = useState<'laden' | 'ja' | 'nee'>(vooraf ? 'laden' : 'nee')

  useEffect(() => {
    if (!vooraf) return
    let afgebroken = false
    void haalAanvraag(vooraf).then((a) => {
      if (afgebroken) return
      if (a) {
        setSoort(a.soort)
        setGekozen(a)
        setFeedback('ja')
      } else {
        setFeedback('nee')
        setError('We konden de aanvraag uit je mail niet meer vinden. Zoek hem hieronder op.')
        setErrorNonce((n) => n + 1)
      }
    })
    return () => {
      afgebroken = true
    }
  }, [vooraf])

  // Zolang er nog niet gekozen is, telt de route van een evenement: die is even lang. Wordt het menu
  // aangepast, dan komt dat scherm direct na de toelichting.
  const basis = STAPPEN[feedback === 'ja' ? 'feedback' : (soort ?? 'evenement')]
  const stappen: readonly Stap[] = draft.menu ? basis.flatMap((s) => (s === 'toelichting' ? [s, 'menu' as const] : [s])) : basis
  const heeftMenu = Boolean(gekozen && vraagtOmMenu(gekozen.aanvraag_types))
  const [menuLaden, setMenuLaden] = useState(false)
  const stap: Stap = stappen[index]
  const verlopen = deadlineVerlopen(gekozen)
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }))

  /**
   * Een andere aanvraag gekozen: de datums die je voor de vorige had aangepast horen daar niet bij.
   * Wie een aanvraag met een verlopen deadline kiest, staat straks voor een verplichte nieuwe.
   */
  const kies = (a: GevondenAanvraag | null) => {
    setGekozen(a)
    setDraft((d) => ({ ...d, nieuwe_event_datum: null, nieuwe_deadline: null, menu: null }))
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

  /**
   * "Menu aanpassen": het menu van de aanvraag ophalen en het menuscherm openen. In de zoeklijst
   * staat het menu niet; dan halen we de aanvraag nog even op. Lukt dat niet, dan begin je bij
   * de pakketkeuze in plaats van vast te lopen.
   */
  async function openMenu() {
    if (!gekozen) return
    let menu = draft.menu
    if (!menu) {
      setMenuLaden(true)
      const info = gekozen.menu !== undefined ? gekozen.menu : (await haalAanvraag(gekozen.id))?.menu
      setMenuLaden(false)
      menu = menuVan(info ?? null)
      patch({ menu })
    }
    ga(stappen.indexOf('toelichting') + 1, 1)
  }

  /** "Menu toch niet aanpassen": terug naar de toelichting, het menu blijft zoals het was. */
  const laatMenu = () => {
    patch({ menu: null })
    ga(stappen.indexOf('toelichting'), -1)
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
      // Wie alleen het menu aanpast, hoeft er niets bij te typen: het menu zegt genoeg.
      if (t.length < 5 && !draft.menu) return 'Vertel kort wat er moet veranderen.'
      if (t.length > 3000) return 'Houd het bij maximaal 3000 tekens.'
      return null
    }
    if (stap === 'menu') {
      if (!draft.menu?.pakket) return 'Kies een pakket.'
      if (!aantalGerechten(draft.menu)) return 'Er staat geen enkel gerecht meer in het menu.'
      return null
    }
    // Laatste stap: alles is optioneel, behalve een nieuwe deadline als de oude al voorbij is.
    if (uploads.bezig) return 'Je bestanden worden nog geüpload — nog heel even.'
    // Het menu kan onderweg weer zijn weggehaald; dan moet er toch iets in de toelichting staan.
    if (draft.toelichting.trim().length < 5 && !draft.menu) return 'Vertel bij de vorige vragen kort wat er moet veranderen.'
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
          menu_inhoud: draft.menu ? naarInhoud(draft.menu) : null,
          menu_tekst: draft.menu ? naarTekst(draft.menu) : '',
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
      // Op de pakketkeuze werken de letters, net als in het formulier.
      if (stap === 'menu' && draft.menu && !draft.menu.pakket && el?.tagName !== 'INPUT' && !e.metaKey && !e.ctrlKey && e.key.length === 1) {
        const pakket = PAKKETTEN_OP_SCHERM[LETTERS.indexOf(e.key.toUpperCase())]
        if (pakket) {
          e.preventDefault()
          patch({ menu: uitPakket(pakket.pakket) })
          return
        }
      }
      if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey) return
      // Op het menuscherm doen de knoppen (Wissel, weghalen, Pakket wijzigen) hun eigen ding.
      if (stap === 'menu' && el?.tagName === 'BUTTON' && !el.hasAttribute('data-primary-action')) return
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

  if (feedback === 'laden') {
    return (
      <Shell progress={0} counter="" canPrev onPrev={onSluit} canNext={false} onNext={() => {}}>
        <p className="hint" aria-live="polite">Je aanvraag wordt opgezocht…</p>
      </Shell>
    )
  }

  const waarover = gekozen ? (gekozen.soort === 'intern' ? gekozen.omschrijving || 'je interne aanvraag' : gekozen.event) : ''

  const titels: Record<Stap, string> = {
    soort: 'Is het voor een evenement of intern?',
    zoek: 'Bij welk event hoort het?',
    naam: 'Wie ben je?',
    kies: 'Over welke aanvraag gaat het?',
    toelichting: feedback === 'ja' ? 'Wat wil je anders?' : 'Wat moet erbij of anders?',
    menu: 'Pas het menu aan',
    extra: verlopen ? 'De deadline is verstreken' : 'Verandert er nog iets aan de aanvraag?',
  }
  const hulp: Record<Stap, string | undefined> = {
    soort: 'Dan zoeken we de goede aanvraag erbij.',
    zoek: 'Typ een deel van de eventnaam. Je ziet de aanvragen van de afgelopen maanden.',
    naam: feedback === 'ja'
      ? `Je geeft feedback op ${waarover}. Dan weet Marketing van wie hij komt.`
      : soort === 'intern'
        ? 'Je naam zoals je hem bij de aanvraag invulde; dan zoeken we je interne aanvragen erbij.'
        : 'Dan weet Marketing wie deze aanvulling stuurde.',
    kies: 'Je interne aanvragen van de afgelopen maanden.',
    toelichting: feedback === 'ja'
      ? 'Wat moet er anders aan het ontwerp? Hoe concreter, hoe sneller het goed is. Heb je bestanden of een screenshot met aantekeningen, voeg ze hier toe.'
      : 'Extra wensen, iets wat erbij moet komen, aanvullende informatie of feedback op het concept. Heb je bestanden, voeg ze hier meteen toe. Het marketingteam krijgt er meteen bericht van.',
    menu: 'Zo staat het menu nu bij je aanvraag. Wissel of verwijder gerechten, voeg er een toe, of kies onder "Pakket wijzigen" een ander pakket.',
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
                  // Bij een interne aanvraag hangt de lijst hierna van je naam af. Via de feedbacklink
                  // staat de aanvraag al vast, en mag ook een collega feedback geven.
                  if (soort === 'intern' && gekozen && feedback !== 'ja') kies(null)
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
            {/* De bestanden horen bij wat er moet veranderen, dus ze staan hier en niet pas op het laatste scherm. */}
            {stap === 'toelichting' ? (
              <FileField bijlagen={uploads.bijlagen} onKies={uploads.kies} onVerwijder={uploads.verwijder} />
            ) : null}
            {/* Alleen als er een menukaart of menuscherm bij de aanvraag hoort. */}
            {stap === 'toelichting' && heeftMenu ? (
              <MenuKnop aangepast={Boolean(draft.menu)} laden={menuLaden} onOpen={() => void openMenu()} onLaat={() => patch({ menu: null })} />
            ) : null}

            {stap === 'menu' && draft.menu ? (
              <>
                <MenuPicker menu={draft.menu} onChange={(menu) => patch({ menu })} />
                <button type="button" className="link menu-laat" onClick={laatMenu}>
                  Menu toch niet aanpassen
                </button>
              </>
            ) : null}

            {stap === 'extra' ? <ExtraVelden draft={draft} patch={patch} gekozen={gekozen} verlopen={verlopen} /> : null}
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
    ? [a.deadline ? `nodig op ${formatShort(a.deadline)}` : 'geen deadline']
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

/**
 * De knop onder de bijlagen. Nog niet aangepast: "Menu aanpassen". Al aangepast: zeggen dat het
 * meegaat, met de weg terug naar het menu en de weg eruit.
 */
function MenuKnop({ aangepast, laden, onOpen, onLaat }: { aangepast: boolean; laden: boolean; onOpen: () => void; onLaat: () => void }) {
  if (aangepast) {
    return (
      <div className="menuknop menuknop--aangepast">
        <Icon name="check" />
        <span className="menuknop__tekst">
          <strong>Menu aangepast</strong>
          <span className="menuknop__uitleg">Het nieuwe menu gaat mee met je aanvulling.</span>
        </span>
        <button type="button" className="link" onClick={onOpen}>bekijken</button>
        <button type="button" className="link" onClick={onLaat}>toch niet</button>
      </div>
    )
  }
  return (
    <button type="button" className="menuknop" onClick={onOpen} disabled={laden}>
      <Icon name="arrow-right" />
      <span className="menuknop__tekst">
        <strong>{laden ? 'Menu ophalen…' : 'Menu aanpassen'}</strong>
        <span className="menuknop__uitleg">Gerechten wisselen of een ander pakket kiezen.</span>
      </span>
    </button>
  )
}

/** De wijzigingen. Leeg laten betekent: laat staan wat er staat - behalve een verlopen deadline. */
function ExtraVelden({
  draft,
  patch,
  gekozen,
  verlopen,
}: {
  draft: Draft
  patch: (p: Partial<Draft>) => void
  gekozen: GevondenAanvraag | null
  verlopen: boolean
}) {
  const intern = gekozen?.soort === 'intern'
  return (
    <div className="extra">
      {verlopen && gekozen?.deadline ? (
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
            leeg="geen deadline"
            huidig={gekozen?.deadline ?? null}
            waarde={draft.nieuwe_deadline}
            onKies={(iso) => patch({ nieuwe_deadline: iso })}
            onWis={() => patch({ nieuwe_deadline: null })}
            verplicht={verlopen}
          />
        </div>
      </section>

      <section className="extra__blok">
        <h2 className="extra__kop">Staat er materiaal op de schijf of online?</h2>
        <p className="extra__uitleg">
          Verwijs naar een map op de G:-schijf of een link.
          {gekozen?.schijf_locatie ? ` Bij je aanvraag staat nu: ${gekozen.schijf_locatie} — vul je iets anders in, dan geven we dat erbij door.` : ' Alles hier mag leeg blijven.'}
        </p>

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
  leeg = 'onbekend',
}: {
  label: string
  huidig: string | null
  /** Wat er staat als er (nog) geen datum is; bij een interne aanvraag kan de deadline ontbreken. */
  leeg?: string
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
          {huidig ? formatShort(huidig) : leeg}{' '}
          <button type="button" className="link" onClick={() => setOpen(true)}>
            {huidig ? 'wijzigen' : 'toevoegen'}
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
          {huidig ? `toch laten staan op ${formatShort(huidig)}` : `toch ${leeg}`}
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
