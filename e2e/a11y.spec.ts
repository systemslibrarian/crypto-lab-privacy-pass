import { test, expect } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
import { contrastRatio } from './contrast.js'
import { auditNonText } from './nontext.js'

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

async function scan(page: import('@playwright/test').Page, label: string): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(tags).analyze()
  expect(result.violations, `${label}: axe violations`).toEqual([])
  expect(result.incomplete, `${label}: axe incomplete results`).toEqual([])
  const nonText = await auditNonText(page)
  expect(nonText, `${label}: non-text contrast findings (no suppression list exists; every control must pass)`).toEqual([])
  const invisibleText = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('body *')].filter((element) => {
    if (!element.checkVisibility({ checkVisibilityCSS: true })) return false
    const ownsText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
    return ownsText && Number.parseFloat(getComputedStyle(element).opacity) === 0
  }).map((element) => element.id || element.className || element.tagName))
  expect(invisibleText, `${label}: visible text at opacity zero`).toEqual([])
}

test('production page has no WCAG 2.1 A/AA violations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy Pass' })).toBeVisible()
  await expect(page.locator('#app')).not.toBeEmpty()
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
  await scan(page, 'default')
})

test('every reachable protocol state passes the complete gate', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.getByRole('button', { name: '1. Issue token' }).click()
  await scan(page, 'private issued')
  await page.getByRole('button', { name: '2. Redeem at origin' }).click()
  await scan(page, 'private redeemed')
  await page.getByRole('button', { name: '3. Try to link ledgers' }).click()
  await scan(page, 'private compared')
  await page.getByRole('button', { name: 'Replay token' }).click()
  await scan(page, 'replay refused')
  await page.getByLabel(/BROKEN: remove blinding/).check()
  await page.getByRole('button', { name: '1. Issue token' }).click()
  await page.getByRole('button', { name: '2. Redeem at origin' }).click()
  await page.getByRole('button', { name: '3. Try to link ledgers' }).click()
  await scan(page, 'unblinded linked')
  await page.getByLabel(/BROKEN: per-client published key/).check()
  await page.getByRole('button', { name: '1. Issue token' }).click()
  await page.getByRole('button', { name: '2. Redeem at origin' }).click()
  await page.getByRole('button', { name: '3. Try to link ledgers' }).click()
  await scan(page, 'key partitioned')
  await page.getByLabel(/BROKEN: unpublished issuer key/).check()
  await page.getByRole('button', { name: '1. Issue token' }).click()
  await scan(page, 'unpublished key abort')
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