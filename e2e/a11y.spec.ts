import { test, expect } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'

test('production page has no WCAG 2.1 A/AA violations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy Pass' })).toBeVisible()
  await expect(page.locator('#app')).not.toBeEmpty()
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(result.violations).toEqual([])
  expect(result.incomplete).toEqual([])
})