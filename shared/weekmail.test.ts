import { describe, expect, it } from 'vitest'
import { maakWeekoverzicht, nietsTeMelden, renderWeekmail, taakUitAsana, weekVan, type WeekTaak } from './weekmail'

// Maandag 26 oktober 2026, week 44.
const MA = '2026-10-26'

function taak(over: Partial<WeekTaak> = {}): WeekTaak {
  return {
    naam: 'EY - 11 december - Britt - Deadline: 28 oktober - Torenscherm',
    url: 'https://app.asana.com/0/1/2',
    locatie: 'nbc',
    deadline: '2026-10-28',
    eventdatum: '2026-12-11',
    vervaldatum: '2026-10-27',
    sectie: 'mee_bezig',
    sectieNaam: 'Mee bezig',
    spoed: false,
    ...over,
  }
}

describe('weekVan', () => {
  it('geeft maandag t/m zondag en het ISO-weeknummer', () => {
    expect(weekVan(MA)).toEqual({ maandag: '2026-10-26', zondag: '2026-11-01', weeknummer: 44 })
    expect(weekVan('2026-11-01')).toEqual({ maandag: '2026-10-26', zondag: '2026-11-01', weeknummer: 44 })
  })

  it('klopt rond de jaarwisseling', () => {
    // 1 januari 2027 is een vrijdag: dat hoort nog bij week 53 van 2026.
    expect(weekVan('2027-01-01')).toEqual({ maandag: '2026-12-28', zondag: '2027-01-03', weeknummer: 53 })
    expect(weekVan('2027-01-04').weeknummer).toBe(1)
  })
})

describe('maakWeekoverzicht', () => {
  it('zet de deadlines van deze week per dag, en volgende week apart', () => {
    const o = maakWeekoverzicht([
      taak({ naam: 'woensdag', deadline: '2026-10-28' }),
      taak({ naam: 'maandag', deadline: '2026-10-26' }),
      taak({ naam: 'ook woensdag', deadline: '2026-10-28', spoed: true }),
      taak({ naam: 'volgende week', deadline: '2026-11-03' }),
      taak({ naam: 'over twee weken', deadline: '2026-11-10' }),
    ], MA)
    expect(o.dezeWeek.map((d) => [d.dag, d.taken.map((t) => t.naam)])).toEqual([
      ['2026-10-26', ['maandag']],
      ['2026-10-28', ['ook woensdag', 'woensdag']],
    ])
    expect(o.volgendeWeek.map((t) => t.naam)).toEqual(['volgende week'])
    expect(o.aantal).toBe(3)
    expect(o.spoed).toBe(1)
  })

  it('laat wat in Klaar staat buiten beschouwing', () => {
    const o = maakWeekoverzicht([taak({ sectie: 'klaar', sectieNaam: 'Klaar' })], MA)
    expect(o.aantal).toBe(0)
  })

  it('vindt wat aandacht nodig heeft', () => {
    const o = maakWeekoverzicht([
      taak({ naam: 'te laat', deadline: '2026-10-20' }),
      taak({ naam: 'nieuw', sectie: 'nieuwe_aanvragen', vervaldatum: null }),
      taak({ naam: 'feedback', sectie: 'feedback' }),
      taak({ naam: 'te laat gepland', vervaldatum: '2026-10-30' }),
      taak({ naam: 'geen datum', vervaldatum: null, sectie: 'in_planning' }),
    ], MA)
    expect(o.letOp.overDeadline.map((t) => t.naam)).toEqual(['te laat'])
    expect(o.letOp.nietOpgepakt.map((t) => t.naam)).toEqual(['nieuw'])
    expect(o.letOp.feedback.map((t) => t.naam)).toEqual(['feedback'])
    expect(o.letOp.naDeadlineIngepland.map((t) => t.naam)).toEqual(['te laat gepland'])
    // "nieuw" heeft ook geen datum, maar staat al onder Nog niet opgepakt.
    expect(o.letOp.nietIngepland.map((t) => t.naam)).toEqual(['geen datum'])
  })
})

describe('nietsTeMelden', () => {
  it('een lege week, of alleen iets voor volgende week, levert geen mail op', () => {
    expect(nietsTeMelden(maakWeekoverzicht([], MA))).toBe(true)
    expect(nietsTeMelden(maakWeekoverzicht([taak({ deadline: '2026-11-03' })], MA))).toBe(true)
  })

  it('een deadline deze week, of iets om op te letten, wel', () => {
    expect(nietsTeMelden(maakWeekoverzicht([taak()], MA))).toBe(false)
    // Geen deadline deze week, maar wel feedback die wacht.
    expect(nietsTeMelden(maakWeekoverzicht([taak({ deadline: '2026-11-10', sectie: 'feedback' })], MA))).toBe(false)
  })
})

describe('renderWeekmail', () => {
  it('kleurt per locatie', () => {
    expect(renderWeekmail(maakWeekoverzicht([taak()], MA), 'nbc', null).html).toContain('bgcolor="#229d96"')
    const gv = renderWeekmail(maakWeekoverzicht([taak({ locatie: 'green_village' })], MA), 'green_village', 'https://app.asana.com/p').html
    expect(gv).toContain('bgcolor="#a2a68f"')
    expect(gv).toContain('color:#5c6049;font-weight:bold;')
    expect(gv).not.toContain('#229d96')
  })

  it('noemt de week, het aantal deadlines en spoed in het onderwerp', () => {
    const m = renderWeekmail(maakWeekoverzicht([taak(), taak({ spoed: true })], MA), 'nbc', 'https://app.asana.com/project')
    expect(m.aan).toEqual(['marketing@nbcevents.nl'])
    expect(m.onderwerp).toBe('Weekoverzicht designaanvragen NBC week 44: 2 deadlines, 1 spoed')
    expect(m.html).toContain('maandag 26 oktober t/m zondag 1 november')
    expect(m.html).toContain('href="https://app.asana.com/0/1/2"')
    expect(m.html).toContain('SPOED')
    expect(m.html).toContain('Open het bord in Asana')
  })

  it('gaat voor Green Village naar het eigen postvak', () => {
    const m = renderWeekmail(maakWeekoverzicht([], MA), 'green_village', null)
    expect(m.aan).toEqual(['marketing@green-village.nl'])
    expect(m.onderwerp).toBe('Weekoverzicht designaanvragen Green Village week 44: geen deadlines')
    expect(m.html).toContain('Geen deadlines deze week.')
    expect(m.html).toContain('Niets bijzonders')
  })

  it('escapet taaknamen', () => {
    const m = renderWeekmail(maakWeekoverzicht([taak({ naam: 'A&B <test>' })], MA), 'nbc', null)
    expect(m.html).toContain('A&amp;B &lt;test&gt;')
  })
})

describe('taakUitAsana', () => {
  const cfg = {
    project: { gid: 'p1' },
    fields: { deadline: { gid: 'f-dl' }, eventdatum: { gid: 'f-ev' }, spoed: { gid: 'f-sp' }, locatie: { gid: 'f-loc' } },
    sections: { mee_bezig: { gid: 's-bezig', name: 'Mee bezig' } },
  }

  it('leest velden, kolom en locatie uit', () => {
    const t = taakUitAsana({
      name: 'Taak',
      permalink_url: 'https://app.asana.com/x',
      due_on: '2026-10-27',
      memberships: [
        { project: { gid: 'planning' }, section: { gid: 's-andere', name: 'Week 44' } },
        { project: { gid: 'p1' }, section: { gid: 's-bezig', name: 'Mee bezig' } },
      ],
      custom_fields: [
        { gid: 'f-dl', date_value: { date: '2026-10-28' } },
        { gid: 'f-ev', date_value: { date: '2026-12-11' } },
        { gid: 'f-sp', enum_value: { name: 'Ja' } },
        { gid: 'f-loc', enum_value: { name: 'Green Village' } },
      ],
    }, cfg)
    expect(t).toEqual({
      naam: 'Taak',
      url: 'https://app.asana.com/x',
      locatie: 'green_village',
      deadline: '2026-10-28',
      eventdatum: '2026-12-11',
      vervaldatum: '2026-10-27',
      sectie: 'mee_bezig',
      sectieNaam: 'Mee bezig',
      spoed: true,
    })
  })

  it('een taak die met de hand is aangemaakt, zonder velden, telt als NBC zonder deadline', () => {
    const t = taakUitAsana({ name: 'Los', memberships: [{ project: { gid: 'p1' }, section: null }] }, cfg)
    expect(t).toMatchObject({ locatie: 'nbc', deadline: null, spoed: false, sectie: null, vervaldatum: null })
  })
})
