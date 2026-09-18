import { test, expect } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
import { contrastRatio } from './contrast.js'

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

test('owned text and control-boundary colors meet arithmetic contrast thresholds', async () => {
  const textPairs = [
    ['#f5f2e9', '#111513'],
    ['#c9c9bf', '#111513'],
    ['#f2c14e', '#111513'],
    ['#8bd39a', '#19201c'],
    ['#ff8d80', '#19201c'],
    ['#201900', '#f2c14e'],
  ]
  for (const [foreground, background] of textPairs) expect(contrastRatio(foreground, background), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio('#718077', '#19201c'), 'control boundary on surface').toBeGreaterThanOrEqual(3)
})

for (const viewport of [{ width: 360, height: 800 }, { width: 1440, height: 900 }]) {
  test(`layout has no horizontal overflow at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await page.getByRole('button', { name: '1. Issue token' }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await expect(page.getByRole('button', { name: '2. Redeem at origin' })).toBeVisible()
  })
}