// Maakt de mails voor de marketinggids na, met de echte opmaak uit shared/, en zet elk in een
// eenvoudig leesvenster (mail/*.html). Alles is verzonnen: het voorbeeld-event Zorgcongres 2026.
//   node docs/gids-marketing/bron/mails.mts
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderAanvullingMail, renderNieuweAanvraagMail } from '../../../shared/meldingen.ts'
import { maakWeekoverzicht, renderWeekmail, type WeekTaak } from '../../../shared/weekmail.ts'

const hier = dirname(fileURLToPath(import.meta.url))
const asanaUrl = 'https://app.asana.com/0/0/1'
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function venster(naam: string, onderwerp: string, html: string, tijd: string) {
  const pagina = `<!doctype html><html><head><meta charset="utf-8"><style>
body { margin: 0; background: #fff; font: 14px/1.4 "Segoe UI", "Area Normal", Arial, sans-serif; color: #242424; }
.vak { padding: 22px 32px 0; }
.kop { display: inline-block; font-size: 22px; font-weight: 600; margin: 0 0 16px; }
.van { display: flex; align-items: center; gap: 12px; padding-bottom: 16px; border-bottom: 1px solid #e1e1e1; }
.foto { width: 40px; height: 40px; border-radius: 50%; background: #229d96; color: #fff; display: grid; place-items: center; font-weight: 600; }
.naam { font-weight: 600; } .adres, .aan { color: #616161; font-size: 13px; } .tijd { margin-left: auto; color: #616161; font-size: 13px; }
iframe { border: 0; width: 100%; height: 2200px; display: block; }
</style></head><body><div class="vak">
<div class="kop">${esc(onderwerp)}</div>
<div class="van"><div class="foto">D</div><div><div class="naam">Designaanvraag <span class="adres">&lt;designaanvraag@nbcevents.nl&gt;</span></div>
<div class="aan">Aan: marketing@nbcevents.nl</div></div><div class="tijd">${tijd}</div></div></div>
<iframe srcdoc="${esc(html)}"></iframe></body></html>`
  mkdirSync(join(hier, 'mail'), { recursive: true })
  writeFileSync(join(hier, 'mail', `${naam}.html`), pagina)
  console.log(naam, '→', onderwerp)
}

const aanvraag = {
  locatie: 'nbc', naam: 'Abel', soort: 'evenement', event: 'Zorgcongres 2026', event_datum: '2026-12-01', deadline: '2026-11-20',
  website: 'https://www.nbcevents.nl/', schijf_locatie: '', aanvraag_types: ['torenscherm', 'menu_scherm', 'vlaggen'], anders_tekst: '',
  design_modus: 'standaard', omschrijving: 'Welkomsttekst op de torenschermen: "Welkom bij het Zorgcongres 2026". Vier vlaggen voor de ingang.',
  menu_tekst: '', geen_deadline: false,
} as any

const nieuw = renderNieuweAanvraagMail({ aanvraag, aanvraagId: 'x', spoed: false, werkdagenTotEvent: 24, asanaUrl, asanaFout: null, bijlagen: [] })
venster('nieuwe-aanvraag', nieuw.onderwerp, nieuw.html, 'wo 28-10-2026 16:13')

const aanv = renderAanvullingMail({
  naam: 'Abel', toelichting: 'Graag de kopjes op het menuscherm in het teal in plaats van oranje.', link: '', schijfLocatie: '',
  extraTypes: [], andersTekst: '',
  aanvraag: { naam: 'Abel', locatie: 'nbc', soort: 'evenement', event: 'Zorgcongres 2026', omschrijving: '', spoed: false,
    eventDatum: '2026-12-01', deadline: '2026-11-20', eventDatumGewijzigd: false, deadlineGewijzigd: false, types: ['torenscherm', 'menu_scherm', 'vlaggen'] },
  taakNaam: 'Zorgcongres 2026 - 1 december - Abel - Deadline: 20 november - Meerdere designs', asanaUrl, bijgewerkt: [], bijlagen: [], heropend: true, menu: null, asanaFout: null,
} as any)
venster('aanvulling', aanv.onderwerp, aanv.html, 'wo 28-10-2026 16:38')

const t = (naam: string, deadline: string, eventdatum: string, sectie: WeekTaak['sectie'], vervaldatum: string | null, spoed = false): WeekTaak =>
  ({ naam, url: asanaUrl, locatie: 'nbc', deadline, eventdatum, vervaldatum, sectie, sectieNaam: null, spoed })
const taken: WeekTaak[] = [
  t('Zorgcongres 2026 - 1 december - Abel - Deadline: 20 november - Meerdere designs', '2026-11-20', '2026-12-01', 'in_planning', '2026-11-18'),
  t('Jaarcongres Voorbeeld BV - 24 november - Noa - Deadline: 18 november - Torenscherm', '2026-11-18', '2026-11-24', 'in_planning', '2026-11-17'),
  t('Klantdag Demo Groep - 26 november - Daan - Deadline: 19 november - Menu scherm', '2026-11-19', '2026-11-26', 'nieuwe_aanvragen', null, true),
  t('Netwerkborrel Testbedrijf - 20 november - Fenna - Deadline: 13 november - Vlaggen', '2026-11-13', '2026-11-20', 'feedback', '2026-11-12', true),
  t('Seminar Voorbeeld - 2 december - Bo - Deadline: 25 november - LED-kolom', '2026-11-25', '2026-12-02', 'in_planning', '2026-11-24'),
]
const o = maakWeekoverzicht(taken, '2026-11-16')
const week = renderWeekmail(o, 'nbc', 'https://app.asana.com/0/0')
venster('weekmail', week.onderwerp, week.html, 'ma 16-11-2026 08:04')
