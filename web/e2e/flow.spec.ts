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
    await expect(page.getByRole('heading', { name: /Voor welke locatie/ })).toBeVisible()

    // 1. Locatie: doorgaan zonder keuze geeft een fout
    await page.keyboard.press('Enter')
    await expect(page.getByRole('alert')).toContainText('Kies een locatie')
    await page.keyboard.press('a')
    await expect(page.getByRole('radio', { name: 'NBC' })).toHaveAttribute('aria-checked', 'true')
    await shot(page, '00b-locatie', p)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Hoe heet je?' })).toBeVisible()

    // 3. Naam: doorgaan zonder keuze geeft een fout
    await page.keyboard.press('Enter')
    await expect(page.getByRole('alert')).toContainText('Vul je naam in')
    await page.getByPlaceholder('Typ of kies je naam').fill('noa')
    await shot(page, '01-naam', p)
    await page.getByRole('option', { name: 'Noa Demo' }).click()
    await expect(page.getByPlaceholder('Typ of kies je naam')).toHaveValue('Noa Demo')
    await page.keyboard.press('Enter')

    // Evenement of intern
    await expect(page.getByRole('heading', { name: 'Is het voor een evenement of intern?' })).toBeVisible()
    await page.keyboard.press('a')
    await expect(page.getByRole('radio', { name: 'Voor een evenement' })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Enter')

    // 3. Event
    await expect(page.getByRole('heading', { name: 'Voor welk event is het?' })).toBeVisible()
    await page.keyboard.type('Zorgcongres 2026')
    await shot(page, '02-event', p)
    await page.keyboard.press('Enter')

    // 4. Eventdatum: kies een dag ruim in de toekomst (volgende maand, 15e)
    await expect(page.getByRole('heading', { name: 'Wanneer is het event?' })).toBeVisible()
    await page.getByRole('button', { name: 'Volgende maand' }).click()
    await page.locator('button.date__day:not([disabled])', { hasText: /^15$/ }).click()
    await expect(page.locator('.date__selected')).toContainText('Gekozen')
    await shot(page, '03-eventdatum', p)
    await page.keyboard.press('Enter')

    // 5. Deadline: eerste beschikbare dag → korte doorlooptijd → waarschuwing, maar geen blokkade
    await expect(page.getByRole('heading', { name: 'Wanneer heb je het uiterlijk nodig?' })).toBeVisible()
    await page.locator('button.date__day:not([disabled])').first().click()
    await expect(page.locator('.msg--warn')).toContainText('werkdagen')
    await shot(page, '04-deadline', p)
    await page.keyboard.press('Enter')

    // 6. Website: ongeldig → fout, daarna geldig
    await expect(page.getByRole('heading', { name: /website/ })).toBeVisible()
    await page.keyboard.type('geen url')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('alert')).toContainText('geldige website')
    await page.getByPlaceholder('www.event.nl').fill('www.nbccongrescentrum.nl')
    await page.keyboard.press('Enter')

    // 7. Schijf (optioneel)
    await expect(page.getByRole('heading', { name: /schijf/ })).toBeVisible()
    await page.keyboard.type('G:\\Events\\2026\\Zorgcongres')
    await page.keyboard.press('Enter')

    // 8. Bestanden (optioneel; we sturen niets mee)
    await expect(page.getByRole('heading', { name: /bestanden/ })).toBeVisible()
    await page.keyboard.press('Enter')

    // 9. Aanvraagtypes via lettertoetsen, incl. Anders
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

    // 10. Modus
    await expect(page.getByRole('heading', { name: /custom of standaard/ })).toBeVisible()
    await page.keyboard.press('a')
    await expect(page.getByRole('radio', { name: /Volledig custom/ })).toHaveAttribute('aria-checked', 'true')
    await shot(page, '08-modus', p)
    await page.keyboard.press('Enter')

    // 11. Omschrijving: Enter is hier een nieuwe regel, geen "verder"
    await expect(page.getByRole('heading', { name: /wensen/ })).toBeVisible()
    await page.keyboard.type('Eerste regel')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Tweede regel')
    await expect(page.locator('#f-omschrijving')).toHaveValue('Eerste regel\nTweede regel')
    // En we staan nog steeds op dezelfde vraag: Enter heeft niets doorgestuurd.
    await expect(page.getByRole('heading', { name: /wensen/ })).toBeVisible()
    await shot(page, '09-omschrijving', p)
    await page.locator('[data-primary-action]').click()

    // 12. Overzicht
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
    await page.getByRole('radio', { name: 'NBC' }).click()
    await page.locator('[data-primary-action]').click()
    await page.getByPlaceholder('Typ of kies je naam').fill('fen')
    await page.getByRole('option', { name: 'Fenna Demo' }).click()
    await page.keyboard.press('Enter')
    await page.getByRole('radio', { name: 'Voor een evenement' }).click()
    await page.locator('[data-primary-action]').click()
    await expect(page.getByRole('heading', { name: 'Voor welk event is het?' })).toBeVisible()
    // Het veld rechtstreeks vullen; waar de focus na de namenlijst belandt doet er voor
    // deze test niet toe, het gaat erom dat het concept bewaard blijft.
    await page.getByPlaceholder('Bijvoorbeeld Zorgcongres 2026').fill('Kerstborrel')
    await page.waitForFunction(() => (localStorage.getItem('nbc-designaanvraag:draft:v3') ?? '').includes('Kerstborrel'))
    await page.reload()
    await expect(page.locator('.resume')).toBeVisible()
    await page.getByRole('button', { name: 'Verder' }).click()
    await expect(page.getByRole('heading', { name: 'Voor welk event is het?' })).toBeVisible()
    await expect(page.getByPlaceholder('Bijvoorbeeld Zorgcongres 2026')).toHaveValue('Kerstborrel')
    await page.getByRole('button', { name: 'Vorige vraag' }).click()
    await expect(page.getByRole('radio', { name: 'Voor een evenement' })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('button', { name: 'Vorige vraag' }).click()
    await expect(page.getByPlaceholder('Typ of kies je naam')).toHaveValue('Fenna Demo')
  })

  test('interne aanvraag met een naam die niet in de lijst staat', async ({ page }, testInfo) => {
    const p = testInfo.project.name
    await page.goto('/')
    await page.getByRole('button', { name: 'Start' }).click()
    await page.getByRole('radio', { name: 'NBC' }).click()
    await page.locator('[data-primary-action]').click()

    // Een naam die niet in de lijst staat: gewoon typen en door met Enter.
    await page.getByPlaceholder('Typ of kies je naam').fill('Jan Nieuwkomer')
    await expect(page.locator('.combo__nieuw')).toContainText('Niet in de lijst')
    await page.keyboard.press('Enter')

    await expect(page.getByRole('heading', { name: 'Is het voor een evenement of intern?' })).toBeVisible()
    await page.keyboard.press('b')
    await expect(page.getByRole('radio', { name: 'Intern' })).toHaveAttribute('aria-checked', 'true')
    await shot(page, '20-soort', p)
    await page.keyboard.press('Enter')

    // Meteen door naar wat je wilt: geen event, geen eventdatum.
    await expect(page.getByRole('heading', { name: 'Wat wil je aanvragen?' })).toBeVisible()
    await page.locator('[data-primary-action]').click()
    await expect(page.getByRole('alert')).toContainText('Beschrijf wat je wilt aanvragen')
    await page.locator('#f-wens-intern').fill('Nieuwe visitekaartjes voor het salesteam.')
    await shot(page, '21-wens-intern', p)
    await page.locator('[data-primary-action]').click()

    await expect(page.getByRole('heading', { name: 'Wanneer heb je het nodig?' })).toBeVisible()
    await page.getByRole('button', { name: 'Volgende maand' }).click()
    await page.locator('button.date__day:not([disabled])', { hasText: /^15$/ }).click()
    // Na een keuze springt de focus naar de knop; pas dan is Enter "verder" en niet "deze dag".
    await expect(page.locator('[data-primary-action]')).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(page.getByRole('heading', { name: 'Klopt dit?' })).toBeVisible()
    const labels = await page.locator('.review__label').allTextContents()
    expect(labels).toEqual(['locatie', 'naam', 'voor', 'wat je aanvraagt', 'nodig op'])
    await expect(page.locator('.review__row', { hasText: 'naam' }).first().locator('.review__value')).toHaveText('Jan Nieuwkomer')
    await shot(page, '22-overzicht-intern', p)

    await page.getByRole('button', { name: 'Verstuur aanvraag' }).click()
    await expect(page.getByRole('heading', { name: 'Gelukt.' })).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.success__status')).toContainText('plant het in')
  })

  test('aanvullen op een evenement met een verlopen deadline', async ({ page }, testInfo) => {
    const p = testInfo.project.name
    await page.goto('/')
    await page.getByRole('button', { name: 'Iets aanvullen of wijzigen' }).click()

    await expect(page.getByRole('heading', { name: 'Is het voor een evenement of intern?' })).toBeVisible()
    await page.keyboard.press('a')
    await page.keyboard.press('Enter')

    await expect(page.getByRole('heading', { name: 'Bij welk event hoort het?' })).toBeVisible()
    await page.locator('#a-zoek').fill('Zorgdag')
    await expect(page.locator('.vondst')).toContainText('deadline verstreken')
    await page.locator('.vondst').first().click()
    await page.locator('[data-primary-action]').click()

    await expect(page.getByRole('heading', { name: 'Wie ben je?' })).toBeVisible()
    // Een naam buiten de lijst, en dan één Enter: die moet meteen door.
    await page.getByPlaceholder('Typ of kies je naam').fill('Iemand Anders')
    await page.keyboard.press('Enter')

    await expect(page.getByRole('heading', { name: 'Wat moet erbij of anders?' })).toBeVisible()
    await page.locator('#a-toelichting').fill('Er komen ook vlaggen bij.')
    await page.locator('[data-primary-action]').click()

    // De stap met de wijzigingen: geen "Komt er iets bij?" meer, wel een duidelijke melding.
    await expect(page.getByRole('heading', { name: 'De deadline is verstreken' })).toBeVisible()
    await expect(page.locator('.msg--verlopen')).toContainText('al voorbij')
    await expect(page.getByText('Komt er iets bij?')).toHaveCount(0)
    await shot(page, '30-verlopen', p)
    await page.getByRole('button', { name: 'Versturen' }).click()
    await expect(page.locator('.msg--error')).toContainText('Kies een nieuwe deadline')

    // Een nieuwe deadline kiezen, en dan mag het wel. Het event is al geweest, dus die mag erna liggen.
    await page.getByRole('button', { name: 'Volgende maand' }).last().click()
    await page.locator('.datumregel').last().locator('button.date__day:not([disabled])', { hasText: /^15$/ }).click()
    await page.getByRole('button', { name: 'Versturen' }).click()
    await expect(page.getByRole('heading', { name: 'Genoteerd.' })).toBeVisible({ timeout: 10_000 })
  })

  test('aanvullen op een interne aanvraag: zoeken op je naam', async ({ page }, testInfo) => {
    const p = testInfo.project.name
    await page.goto('/')
    await page.getByRole('button', { name: 'Iets aanvullen of wijzigen' }).click()
    await page.getByRole('radio', { name: 'Intern' }).click()
    await page.locator('[data-primary-action]').click()

    // Geen vraag naar het event: meteen je naam.
    await expect(page.getByRole('heading', { name: 'Wie ben je?' })).toBeVisible()
    await page.getByPlaceholder('Typ of kies je naam').fill('alex')
    await page.getByRole('option', { name: 'Alex Demo' }).click()
    await page.locator('[data-primary-action]').click()

    await expect(page.getByRole('heading', { name: 'Over welke aanvraag gaat het?' })).toBeVisible()
    await expect(page.locator('.vondst')).toHaveCount(2)
    await shot(page, '31-eigen-aanvragen', p)
    await page.locator('.vondst', { hasText: 'visitekaartjes' }).click()
    await page.locator('[data-primary-action]').click()

    await page.locator('#a-toelichting').fill('Graag ook een versie in het Engels.')
    await page.locator('[data-primary-action]').click()

    // Een interne aanvraag heeft geen eventdatum om te wijzigen.
    await expect(page.getByRole('heading', { name: 'Verandert er nog iets aan de aanvraag?' })).toBeVisible()
    await expect(page.locator('.datumregel')).toHaveCount(1)
    await expect(page.locator('.datumregel')).toContainText('Deadline')
    await page.getByRole('button', { name: 'Versturen' }).click()
    await expect(page.getByRole('heading', { name: 'Genoteerd.' })).toBeVisible({ timeout: 10_000 })
  })
})
