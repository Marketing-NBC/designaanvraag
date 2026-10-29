// Maakt de screenshots voor de gids "Designs aanvragen bij Marketing" (zie ../README.md).
// Draait tegen het formulier in mock-modus: npm run build -w web, dan
// npx vite preview --host 127.0.0.1 --port 4173 in web/, en dan: node docs/gids-projecten/bron/screenshots.cjs
const { chromium } = require('playwright');
const path = require('path');
const OUT = path.join(__dirname, 'shots');
const LOGO = path.join(__dirname, 'logo-zorgcongres.png');
const URL = process.env.URL || 'http://127.0.0.1:4173/';
const fs = require('fs'); fs.mkdirSync(OUT, { recursive: true });
const NAMEN = { 'Alex Demo': 'Alex de Vries', 'Bo Demo': 'Bo Kok', 'Casper Demo': 'Casper Visser', 'Demi Demo': 'Demi Bakker', 'Fenna Demo': 'Fenna Smit', 'Noa Demo': 'Noa Mulder' };
async function namen(p) {
  await p.evaluate((N) => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) for (const [a, b] of Object.entries(N)) if (n.nodeValue.includes(a)) n.nodeValue = n.nodeValue.split(a).join(b);
    document.querySelectorAll('input,textarea').forEach((el) => { for (const [a, b] of Object.entries(N)) if (el.value.includes(a)) el.value = el.value.split(a).join(b); });
  }, NAMEN);
}
// marks: array of [selectorOrLocator, n]
async function mark(p, marks) {
  await p.evaluate(() => document.querySelectorAll('.gids-mark').forEach((e) => e.remove()));
  for (const [loc, n, pad = 6] of marks) {
    const l = typeof loc === 'string' ? p.locator(loc).first() : loc;
    const bb = await l.boundingBox();
    if (!bb) { console.log('geen box voor', n); continue; }
    await p.evaluate(({ bb, n, pad, nummers }) => {
      const d = document.createElement('div'); d.className = 'gids-mark';
      Object.assign(d.style, { position: 'fixed', left: (bb.x - pad) + 'px', top: (bb.y - pad) + 'px', width: (bb.width + 2 * pad) + 'px', height: (bb.height + 2 * pad) + 'px',
        border: '3px solid #E8590C', borderRadius: '12px', zIndex: 99999, pointerEvents: 'none', boxSizing: 'border-box' });
      if (nummers) {
        const b = document.createElement('div'); b.textContent = n;
      Object.assign(b.style, { position: 'absolute', right: '-15px', top: '-15px', width: '28px', height: '28px', borderRadius: '50%', background: '#E8590C', color: '#fff',
        font: '800 16px/28px "Area Normal", Arial, sans-serif', textAlign: 'center', boxShadow: '0 0 0 2px #fff' });
      d.appendChild(b);
      } document.body.appendChild(d);
    }, { bb, n, pad, nummers: NUMMERS });
  }
}
const W = 1280, H = 760;
// De gids heeft bolletjes in plaats van nummers, dus de kaders krijgen geen nummer.
const NUMMERS = false;
async function shot(p, name, marks = []) {
  await p.mouse.move(2, 2);
  await p.waitForTimeout(800);
  await namen(p);
  await mark(p, marks);
  await p.screenshot({ path: `${OUT}/${name}.png` });
  await p.evaluate(() => document.querySelectorAll('.gids-mark').forEach((e) => e.remove()));
}
const next = (p) => p.locator('[data-primary-action]').click();
async function kiesDatum(p, maandenVerder, dag) {
  for (let i = 0; i < maandenVerder; i++) await p.getByRole('button', { name: 'Volgende maand' }).last().click();
  await p.locator('button.date__day:not([disabled])', { hasText: new RegExp(`^${dag}$`) }).last().click();
}
async function start(b) {
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2, locale: 'nl-NL', timezoneId: 'Europe/Amsterdam' });
  await p.goto(URL);
  await p.evaluate(() => localStorage.clear()); await p.reload();
  await p.getByRole('heading', { name: 'Designaanvraag' }).waitFor();
  return p;
}
async function stappen(b) {
  const L = (p, s, o) => p.locator(s, o).first();
  const naam = async (p) => { await p.getByPlaceholder('Typ of kies je naam').fill('Noa'); await p.getByRole('option', { name: 'Noa Demo' }).click(); };
  // ── Evenement ──
  let p = await start(b);
  await shot(p, 'omslag');
  await shot(p, 'g01-start', [[p.getByRole('button', { name: 'Start' }), 1, 8]]);
  await p.getByRole('button', { name: 'Start' }).click();
  await p.getByRole('radio', { name: 'NBC' }).click();
  await shot(p, 'g02-vraag', [[L(p, '.q__head'), 1, 8], [p.getByRole('radio', { name: 'NBC' }), 2, 5], [L(p, '.q__footer'), 2, 8], [L(p, '.navdock'), 3, 6]]);
  await next(p); await naam(p); await next(p);
  await p.getByRole('radio', { name: 'Voor een evenement' }).click(); await next(p);
  await p.getByPlaceholder('Bijvoorbeeld Zorgcongres 2026').fill('Zorgcongres 2026'); await next(p);
  await kiesDatum(p, 2, 1);
  await shot(p, 'g03-eventdatum', [[L(p, '.date__nav, .date__head'), 1, 6], [L(p, 'button.date__day[aria-pressed="true"]'), 1, 5]]);
  await next(p);
  await kiesDatum(p, 1, 20);
  await next(p);
  await p.getByRole('radio', { name: /Standaard designs/ }).click();
  await shot(p, 'g08-modus', [[p.getByRole('radio', { name: /Standaard designs/ }), 1, 6], [p.getByRole('radio', { name: /Volledig custom/ }), 2, 6]]);
  await next(p);
  await p.getByPlaceholder('www.event.nl').fill('www.zorgcongres.nl');
  await shot(p, 'g05-website', [[p.getByPlaceholder('www.event.nl'), 1, 6]]);
  await next(p);
  await p.getByRole('heading', { name: /schijf/ }).waitFor();
  await p.waitForTimeout(400);
  await p.keyboard.type('G:\\Events\\2026\\Zorgcongres');
  await next(p);
  await L(p, 'input[type=file]').setInputFiles(LOGO);
  await p.waitForTimeout(1500);
  await shot(p, 'g06-bestanden', [[L(p, '.bijlagen__zone'), 1, 6], [L(p, '.bijlage'), 2, 6]]);
  await next(p);
  await p.locator('.opt', { hasText: 'LED-kolom' }).first().click();
  await p.locator('.opt', { hasText: 'Torenscherm' }).first().click();
  await shot(p, 'g07-types', [[p.locator('.opt', { hasText: 'Torenscherm' }), 1, 5]]);
  await next(p);
  await p.locator('#f-omschrijving').fill('Welkomsttekst op de torenschermen: "Welkom bij het Zorgcongres 2026".\nOp de LED-kolom het logo van de opdrachtgever.');
  await shot(p, 'g09-wensen', [[p.locator('#f-omschrijving'), 1, 6], [L(p, '[data-primary-action]'), 2, 6]]);
  await next(p);
  await p.getByRole('heading', { name: 'Klopt dit?' }).waitFor();
  await L(p, '[data-primary-action]').scrollIntoViewIfNeeded();
  await shot(p, 'g10-overzicht', [[p.locator('.review__edit').last(), 1, 6], [L(p, '[data-primary-action]'), 2, 6]]);
  await p.getByRole('button', { name: 'Verstuur aanvraag' }).click();
  await p.getByRole('heading', { name: 'Gelukt.' }).waitFor({ timeout: 10000 });
  await p.evaluate(() => {
    const s = document.querySelector('.success__status'); if (!s) return;
    s.className = 'success__status success__status--done';
    const svg = s.querySelector('svg'); if (svg) svg.innerHTML = '<path d="M5 12.5 10 17 19 7" />';
    s.querySelector('span').innerHTML = 'Logo, kleuren en fonts van <strong>zorgcongres.nl</strong> halen we op de achtergrond op. Daar hoef je niet op te wachten — je kunt dit venster sluiten.';
  });
  await shot(p, 'g11-gelukt', [[L(p, '.success__lead'), 1, 6], [L(p, '.success__status'), 2, 6]]);
  await p.close();

  // ── Intern ──
  p = await start(b);
  await p.getByRole('button', { name: 'Start' }).click();
  await p.getByRole('radio', { name: 'NBC' }).click(); await next(p); await naam(p); await next(p);
  await p.getByRole('radio', { name: 'Intern' }).click();
  await next(p);
  await p.locator('#f-wens-intern').fill('Nieuwe visitekaartjes voor het salesteam, met de nieuwe functietitels. Acht personen; de namen en titels staan in de mail van 20 oktober.');
  await shot(p, 'g21-intern-wens', [[p.locator('#f-wens-intern'), 1, 6]]);
  await next(p);
  await p.getByRole('button', { name: /Geen deadline/ }).click();
  await p.setViewportSize({ width: W, height: 900 });
  await shot(p, 'g22-intern-deadline', [[L(p, '.date'), 1, 6], [p.getByRole('button', { name: /Geen deadline/ }), 2, 6]]);
  await p.close();

  // ── Menu ──
  p = await start(b);
  await p.getByRole('button', { name: 'Start' }).click();
  await p.getByRole('radio', { name: 'NBC' }).click(); await next(p); await naam(p); await next(p);
  await p.getByRole('radio', { name: 'Voor een evenement' }).click(); await next(p);
  await p.getByPlaceholder('Bijvoorbeeld Zorgcongres 2026').fill('Zorgcongres 2026'); await next(p);
  await kiesDatum(p, 2, 1); await next(p);
  await kiesDatum(p, 1, 20); await next(p);
  await p.getByRole('radio', { name: /Standaard designs/ }).click(); await next(p);
  await next(p); await next(p); await next(p);
  await p.getByRole('heading', { name: 'Wat wil je aanvragen?' }).waitFor();
  await p.locator('.opt', { hasText: 'Menu scherm' }).first().click();
  await next(p);
  await shot(p, 'g31-menu-pakket', [[L(p, '.pakket'), 1, 5]]);
  await L(p, '.pakket').click();
  await shot(p, 'g32-menu-inhoud', [[L(p, '.gerecht__knop'), 1, 5], [p.locator('.gerecht__knop--weg').nth(2), 2, 4], [L(p, '.gerecht__toevoegen'), 3, 5], [L(p, '.menu__wissel'), 4, 5]]);
  await p.close();

  // ── Aanvullen ──
  p = await start(b);
  await p.getByRole('button', { name: 'Iets aanvullen of wijzigen' }).click();
  await p.getByRole('radio', { name: 'Voor een evenement' }).click(); await next(p);
  await p.locator('#a-zoek').fill('Zorgcon');
  await L(p, '.vondst').waitFor();
  await L(p, '.vondst').click();
  await shot(p, 'g40-aanv-zoek', [[p.locator('#a-zoek'), 1, 6], [L(p, '.vondst'), 1, 5]]);
  await next(p); await naam(p); await next(p);
  await p.locator('#a-toelichting').fill('De opdrachtgever wil op de torenschermen ook het logo van de hoofdsponsor. Het logo zit in de bijlage.');
  await shot(p, 'g41-aanv-wat', [[p.locator('#a-toelichting'), 1, 6], [L(p, '.bijlagen__zone'), 2, 5], [p.getByRole('button', { name: /Menu aanpassen/ }), 3, 5]]);
  await next(p);
  await p.setViewportSize({ width: W, height: 860 });
  await shot(p, 'g42-aanv-extra', [[L(p, '.extra__datums'), 1, 6]]);
  await p.close();

  p = await start(b);
  await p.getByRole('button', { name: 'Iets aanvullen of wijzigen' }).click();
  await p.getByRole('radio', { name: 'Voor een evenement' }).click(); await next(p);
  await p.locator('#a-zoek').fill('Zorgdag');
  await L(p, '.vondst').waitFor(); await L(p, '.vondst').click(); await next(p);
  await naam(p); await next(p);
  await p.locator('#a-toelichting').fill('Feedback: op de vlag staat de verkeerde datum.');
  await next(p);
  await p.locator('.datumregel').last().locator('button.date__day:not([disabled])', { hasText: /^30$/ }).last().click();
  await p.setViewportSize({ width: W, height: 900 }); await p.locator('.q__head').first().scrollIntoViewIfNeeded();
  await shot(p, 'g43-aanv-verlopen', [[L(p, '.msg--verlopen'), 1, 6], [p.locator('.datumregel').last(), 2, 6]]);
  await p.close();
  // ── Krappe eventdatum: over twee werkdagen ──
  p = await start(b);
  await p.getByRole('button', { name: 'Start' }).click();
  await p.getByRole('radio', { name: 'NBC' }).click(); await next(p); await naam(p); await next(p);
  await p.getByRole('radio', { name: 'Voor een evenement' }).click(); await next(p);
  await p.getByPlaceholder('Bijvoorbeeld Zorgcongres 2026').fill('Zorgcongres 2026'); await next(p);
  const krap = await p.evaluate(() => { const d = new Date(); let n = 0; while (n < 2) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) n++; } return { dag: d.getDate(), maanden: (d.getFullYear() - new Date().getFullYear()) * 12 + d.getMonth() - new Date().getMonth() }; });
  await kiesDatum(p, krap.maanden, krap.dag);
  await p.setViewportSize({ width: W, height: 880 });
  await shot(p, 'g04-krap', [[L(p, '.msg--verlopen'), 1, 6]]);
  await p.close();

  // ── Event over ongeveer anderhalve week: de oranje melding ──
  p = await start(b);
  await p.getByRole('button', { name: 'Start' }).click();
  await p.getByRole('radio', { name: 'NBC' }).click(); await next(p); await naam(p); await next(p);
  await p.getByRole('radio', { name: 'Voor een evenement' }).click(); await next(p);
  await p.getByPlaceholder('Bijvoorbeeld Zorgcongres 2026').fill('Zorgcongres 2026'); await next(p);
  const oranje = await p.evaluate(() => { const d = new Date(); let n = 0; while (n < 7) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) n++; } return { dag: d.getDate(), maanden: (d.getFullYear() - new Date().getFullYear()) * 12 + d.getMonth() - new Date().getMonth() }; });
  await kiesDatum(p, oranje.maanden, oranje.dag);
  await p.setViewportSize({ width: W, height: 860 });
  await shot(p, 'g04-oranje', [[L(p, '.msg--warn'), 1, 6]]);
  await p.close();

  // ── De knop Feedback geven uit de opleveringsmail ──
  p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2, locale: 'nl-NL', timezoneId: 'Europe/Amsterdam' });
  await p.goto(URL + '?feedback=3f2504e0-4f89-41d3-9a0c-0305e82c3301');
  await p.getByPlaceholder('Typ of kies je naam').waitFor();
  await naam(p);
  await shot(p, 'g51-feedback', [[L(p, '.q__head'), 1, 8], [p.getByPlaceholder('Typ of kies je naam'), 2, 6]]);
  await p.close();

  // ── De opleveringsmail zelf, zoals hij in je inbox staat (zie mail.mts) ──
  p = await b.newPage({ viewport: { width: 820, height: 880 }, deviceScaleFactor: 2 });
  await p.goto('file://' + path.join(__dirname, 'mail', 'inbox.html'));
  const mail = p.frameLocator('iframe');
  await mail.getByText('Feedback geven').first().waitFor();
  await shot(p, 'g50-mail', [[p.locator('.kop'), 1, 6], [mail.locator('td', { hasText: /^Bijlagen$/ }).locator('xpath=..'), 2, 4], [mail.locator('a', { hasText: 'Feedback geven' }).locator('xpath=ancestor::table[1]'), 3, 6]]);
  await p.close();
}

(async () => {
  require('child_process').execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', path.join(__dirname, 'mail.mts')], { stdio: 'inherit' });
  const b = await chromium.launch({ args: ['--no-proxy-server'] });
  await stappen(b);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
