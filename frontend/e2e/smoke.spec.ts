import { expect, test } from '@playwright/test'

test('login page renders in Turkish', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Oturum açın' })).toBeVisible()
})
