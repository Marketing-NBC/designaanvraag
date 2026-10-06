import { expect, test, type Page } from '@playwright/test'

const SHOTS = 'e2e/screenshots'

async function shot(page: Page, name: string, project: string) {
  await page.screenshot({ path: `${SHOTS}/${project}-${name}.png`, fullPage: false })
}

test.describe('designaanvraag-flow', () => {
  test('volledige aanvraag via toetsenbord', async ({ page }, testInfo) => {
    const p = testInfo.project.name
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Designaanvraag' })).toBeVisible()
    await shot(page, '00-start', p)

    // Start
    await page.getByRole('button', { name: 'Start' }).click()
    await expect(page.getByRole('heading', { name: 'Hoe heet je?' })).toBeVisible()

    // 1. Naam: doorgaan zonder keuze geeft een fout
    await page.keyboard.press('Enter')
    await expect(page.getByRole('alert')).toContainText('Kies je naam')
    await page.getByPlaceholder('Typ of kies je naam').fill('noa')
    await shot(page, '01-naam', p)
    await page.getByRole('option', { name: 'Noa Demo' }).click()
    await expect(page.getByPlaceholder('Typ of kies je naam')).toHaveValue('Noa Demo')
    await page.keyboard.press('Enter')

    // 2. Event
    await expect(page.getByRole('heading', { name: 'Voor welk event is het?' })).toBeVisible()
    await page.keyboard.type('Zorgcongres 2026')
    await shot(page, '02-event', p)
    await page.keyboard.press('Enter')

    // 3. Eventdatum: kies een dag ruim in de toekomst (volgende maand, 15e)
    await expect(page.getByRole('heading', { name: 'Wanneer is het event?' })).toBeVisible()
    await page.getByRole('button', { name: 'Volgende maand' }).click()
    await page.locator('button.date__day:not([disabled])', { hasText: /^15$/ }).click()
    await expect(page.locator('.date__selected')).toContainText('Gekozen')
    await shot(page, '03-eventdatum', p)
    await page.keyboard.press('Enter')

    // 4. Deadline: eerste beschikbare dag → korte doorlooptijd → waarschuwing, maar geen blokkade
    await expect(page.getByRole('heading', { name: 'Wanneer heb je het uiterlijk nodig?' })).toBeVisible()
    await page.locator('button.date__day:not([disabled])').first().click()
    await expect(page.locator('.msg--warn')).toContainText('werkdagen')
    await shot(page, '04-deadline', p)
    await page.keyboard.press('Enter')

    // 5. Website: ongeldig → fout, daarna geldig
    await expect(page.getByRole('heading', { name: /website/ })).toBeVisible()
    await page.keyboard.type('geen url')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('alert')).toContainText('geldige website')
    await page.getByPlaceholder('www.event.nl').fill('www.nbccongrescentrum.nl')
    await page.keyboard.press('Enter')

    // 6. Schijf (optioneel)
    await expect(page.getByRole('heading', { name: /schijf/ })).toBeVisible()
    await page.keyboard.type('G:\\Events\\2026\\Zorgcongres')
    await page.keyboard.press('Enter')

    // 7. Bestanden (optioneel; we sturen niets mee)
    await expect(page.getByRole('heading', { name: /bestanden/ })).toBeVisible()
    await page.keyboard.press('Enter')

    // 8. Aanvraagtypes via lettertoetsen, incl. Anders
    await expect(page.getByRole('heading', { name: 'Wat wil je aanvragen?' })).toBeVisible()
    await page.keyboard.press('a')
    await page.keyboard.press('g')
    await page.keyboard.press('h')
    await expect(page.getByPlaceholder('Wat wil je aanvragen?')).toBeFocused()
    await page.keyboard.type('Roll-up banner')
    await shot(page, '07-types', p)
    // In "Anders, namelijk..." bevestigt Enter de tekst en legt hij de focus op de knop;
    // pas de tweede Enter gaat door. Zo schiet je niet midden in een woord verder.
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-primary-action]')).toBeFocused()
    await page.keyboard.press('Enter')

    // 9. Modus
    await expect(page.getByRole('heading', { name: /custom of standaard/ })).toBeVisible()
    await page.keyboard.press('a')
    await expect(page.getByRole('radio', { name: /Volledig custom/ })).toHaveAttribute('aria-checked', 'true')
    await shot(page, '08-modus', p)
    await page.keyboard.press('Enter')

    // 10. Omschrijving: Enter is hier een nieuwe regel, geen "verder"
    await expect(page.getByRole('heading', { name: /wensen/ })).toBeVisible()
    await page.keyboard.type('Eerste regel')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Tweede regel')
    await expect(page.locator('#f-omschrijving')).toHaveValue('Eerste regel\nTweede regel')
    // En we staan nog steeds op dezelfde vraag: Enter heeft niets doorgestuurd.
    await expect(page.getByRole('heading', { name: /wensen/ })).toBeVisible()
    await shot(page, '09-omschrijving', p)
    await page.locator('[data-primary-action]').click()

    // 11. Overzicht
    await expect(page.getByRole('heading', { name: 'Klopt dit?' })).toBeVisible()
    // Op label zoeken en niet op volgorde: komt er een regel bij, dan hoort deze test
    // niet om te vallen op een vraag die er niets mee te maken heeft.
    const rij = (label: string) =>
      page.locator('.review__row').filter({ has: page.locator('.review__label', { hasText: new RegExp(`^${label}$`) }) })
    await expect(rij('naam').locator('.review__value')).toHaveText('Noa Demo')
    await expect(rij('aanvraag').locator('.review__value')).toHaveText('LED-kolom, Vlaggen, Roll-up banner')
    await shot(page, '10-overzicht', p)

    // Wijzig event via overzicht en kom terug
    await rij('event').getByRole('button', { name: 'wijzig' }).click()
    await expect(page.getByRole('heading', { name: 'Voor welk event is het?' })).toBeVisible()
    await page.getByPlaceholder('Bijvoorbeeld Zorgcongres 2026').fill('Zorgcongres 2026 editie 2')
    // Doorklikken tot het overzicht er weer staat. Enter werkt hier niet overal: in het
    // tekstvak maakt die een nieuwe regel, want daar typ je alinea's.
    for (let i = 0; i < 12; i++) {
      if (await page.getByRole('heading', { name: 'Klopt dit?' }).isVisible()) break
      await page.locator('[data-primary-action]').click()
      await page.waitForTimeout(250)
    }
    await expect(page.getByRole('heading', { name: 'Klopt dit?' })).toBeVisible()
    await expect(rij('event').locator('.review__value')).toHaveText('Zorgcongres 2026 editie 2')

    // Verstuur (mock)
    await page.getByRole('button', { name: 'Verstuur aanvraag' }).click()
    await expect(page.getByRole('heading', { name: 'Gelukt.' })).toBeVisible({ timeout: 10_000 })
    await shot(page, '11-succes', p)

    // Concept is gewist: herladen toont geen hervat-banner
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Designaanvraag' })).toBeVisible()
    await expect(page.locator('.resume')).toHaveCount(0)
  })

  test('concept wordt bewaard en kan worden hervat', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Start' }).click()
    await page.getByPlaceholder('Typ of kies je naam').fill('fen')
    await page.getByRole('option', { name: 'Fenna Demo' }).click()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Voor welk event is het?' })).toBeVisible()
    // Het veld rechtstreeks vullen; waar de focus na de namenlijst belandt doet er voor
    // deze test niet toe, het gaat erom dat het concept bewaard blijft.
    await page.getByPlaceholder('Bijvoorbeeld Zorgcongres 2026').fill('Kerstborrel')
    await page.waitForFunction(() => (localStorage.getItem('nbc-designaanvraag:draft:v2') ?? '').includes('Kerstborrel'))
    await page.reload()
    await expect(page.locator('.resume')).toBeVisible()
    await page.getByRole('button', { name: 'Verder' }).click()
    await expect(page.getByRole('heading', { name: 'Voor welk event is het?' })).toBeVisible()
    await expect(page.getByPlaceholder('Bijvoorbeeld Zorgcongres 2026')).toHaveValue('Kerstborrel')
    await page.getByRole('button', { name: 'Vorige vraag' }).click()
    await expect(page.getByPlaceholder('Typ of kies je naam')).toHaveValue('Fenna Demo')
  })
})
