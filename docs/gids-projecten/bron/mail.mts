// Maakt de voorbeeld-opleveringsmail voor de gids, met de echte opmaak uit shared/oplevering.ts,
// en zet hem in een eenvoudig leesvenster (mail/inbox.html). Wordt aangeroepen door screenshots.cjs.
//   node --experimental-strip-types docs/gids-projecten/bron/mail.mts
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beschrijvingAlsMailHtml, renderOpleveringMail } from '../../../shared/oplevering.ts'
import { themaVoor } from '../../../shared/mail.ts'

const hier = dirname(fileURLToPath(import.meta.url))
const bericht = beschrijvingAlsMailHtml(
  '<body>Hierbij de designs voor de torenschermen, de LED-kolom en de vlaggen. De drukbestanden van de vlaggen staan op <strong>G:\\Events\\2026\\Zorgcongres</strong>.</body>',
  themaVoor('nbc'),
)
const m = renderOpleveringMail({
  aan: ['noa.mulder@nbcevents.nl'], antwoordAan: ['marketing@nbcevents.nl'],
  aanvraagId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', versie: 1, locatie: 'nbc', soort: 'evenement',
  event: 'Zorgcongres 2026', eventDatum: '2026-12-01', omschrijving: '', types: ['led_kolom', 'torenscherm', 'vlaggen'], andersTekst: '',
  berichtHtml: bericht, afzenderNaam: 'Sanne', links: [], proef: null,
  bijlagen: [{ naam: 'Torenscherm Zorgcongres.jpg', bytes: 1843000 }, { naam: 'LED-kolom Zorgcongres.mp4', bytes: 6200000 }, { naam: 'Vlag Zorgcongres.pdf', bytes: 2400000 }],
})
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const inbox = `<!doctype html><html><head><meta charset="utf-8"><style>
body { margin: 0; background: #fff; font: 14px/1.4 "Segoe UI", "Area Normal", Arial, sans-serif; color: #242424; }
.vak { padding: 22px 32px 0; }
.kop { display: inline-block; font-size: 22px; font-weight: 600; margin: 0 0 16px; }
.van { display: flex; align-items: center; gap: 12px; padding-bottom: 16px; border-bottom: 1px solid #e1e1e1; }
.foto { width: 40px; height: 40px; border-radius: 50%; background: #229d96; color: #fff; display: grid; place-items: center; font-weight: 600; }
.naam { font-weight: 600; } .adres, .aan { color: #616161; font-size: 13px; } .tijd { margin-left: auto; color: #616161; font-size: 13px; }
iframe { border: 0; width: 100%; height: 1400px; display: block; }
</style></head><body><div class="vak">
<div class="kop">${esc(m.onderwerp)}</div>
<div class="van"><div class="foto">D</div><div><div class="naam">Designaanvraag <span class="adres">&lt;designaanvraag@nbcevents.nl&gt;</span></div>
<div class="aan">Aan: Noa Mulder</div></div><div class="tijd">do 19-11-2026 14:12</div></div></div>
<iframe srcdoc="${esc(m.html)}"></iframe></body></html>`
mkdirSync(join(hier, 'mail'), { recursive: true })
writeFileSync(join(hier, 'mail', 'inbox.html'), inbox)
console.log(m.onderwerp)
