import { expect, test } from '@playwright/test'

// Zonder backend toont de pagina een verzonnen design; met backend komt het uit de bucket.
test('torenscherm-preview: het design staat op de foto, en Dichterbij zoomt in', async ({ page }) => {
  await page.goto('/torenscherm/?p=demo')
  await expect(page.getByRole('heading', { name: 'Zorgcongres' })).toBeVisible()
  const scherm = page.locator('.ts-scherm')
  await expect(scherm).toHaveCSS('transform', /matrix3d/)
  await expect(page.getByAltText('Torenscherm Zorgcongres')).toHaveCount(2)

  const voor = await page.locator('.ts-podium').evaluate((el) => getComputedStyle(el).transform)
  await page.getByRole('button', { name: 'Dichterbij' }).click()
  await expect(page.getByRole('button', { name: 'Hele foto' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.locator('.ts-podium').evaluate((el) => getComputedStyle(el).transform)).not.toBe(voor)
})
