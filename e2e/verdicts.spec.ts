import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { collectVerdicts, phantomMarkers, uncoveredMarkers, VERDICT_WORDS, type Manifest, type VerdictScan } from './verdict-scan.js'

const manifest = JSON.parse(readFileSync(new URL('./verdict-mutations.json', import.meta.url), 'utf8')) as Manifest

const MODES = [
  { name: 'private', label: /Private issuance/ },
  { name: 'unblinded', label: /BROKEN: remove blinding/ },
  { name: 'partitioned', label: /BROKEN: per-client published key/ },
  { name: 'substituted', label: /BROKEN: unpublished issuer key/ },
]
const STEPS = ['1. Issue token', '2. Redeem at origin', '3. Try to link ledgers', 'Replay token']

/** Drives every reachable protocol state and hands the caller a fresh scan of each one. */
async function walkEveryState(page: Page, visit: (state: string, scan: VerdictScan) => void): Promise<void> {
  await page.goto('/')
  visit('initial', await page.evaluate(collectVerdicts, VERDICT_WORDS))
  for (const mode of MODES) {
    await page.goto('/')
    await page.getByLabel(mode.label).check()
    visit(`${mode.name}: selected`, await page.evaluate(collectVerdicts, VERDICT_WORDS))
    for (const step of STEPS) {
      const control = page.getByRole('button', { name: step })
      if (!(await control.isEnabled())) continue
      await control.click()
      visit(`${mode.name}: ${step}`, await page.evaluate(collectVerdicts, VERDICT_WORDS))
    }
  }
}

test('every verdict the page renders has a mutation that forced it false', async ({ page }) => {
  const rendered = new Set<string>()
  const nested: string[] = []
  await walkEveryState(page, (state, scan) => {
    scan.markers.forEach((marker) => rendered.add(marker))
    scan.nested.forEach((where) => nested.push(`${state}: ${where}`))
  })
  expect(rendered.size, 'the walk reached no verdict markers at all').toBeGreaterThan(0)
  expect(nested, 'a verdict marker nested inside another hides the inner outcome from the scan').toEqual([])
  expect(uncoveredMarkers(rendered, manifest), 'rendered verdicts with no recorded mutation in e2e/verdict-mutations.json').toEqual([])
  expect(phantomMarkers(rendered, manifest), 'markers claimed by the manifest that no reachable state renders').toEqual([])
})

test('no verdict is rendered outside a marker in any reachable state', async ({ page }) => {
  const styling: string[] = []
  const words: string[] = []
  await walkEveryState(page, (state, scan) => {
    scan.stylingViolations.forEach((violation) => styling.push(`${state}: ${violation.where} — ${violation.reason} — "${violation.text}"`))
    scan.wordViolations.forEach((violation) => words.push(`${state}: ${violation.where} — ${violation.word} — "${violation.text}"`))
  })
  expect(styling, 'verdict styling outside any [data-verdict] marker').toEqual([])
  expect(words, 'verdict vocabulary outside any [data-verdict] marker').toEqual([])
})

test('the coverage checks bite: an unmarked banner and an unregistered marker are both caught', async ({ page }) => {
  await page.goto('/')
  const clean = await page.evaluate(collectVerdicts, VERDICT_WORDS)
  expect(clean.stylingViolations, 'baseline for the negative control must be clean').toEqual([])
  expect(clean.wordViolations, 'baseline for the negative control must be clean').toEqual([])

  // A careless builder adds a banner the way the page's own CSS invites: verdict class, verdict
  // word, no marker. Both detectors have to fire, or marking verdicts is decoration.
  await page.evaluate(() => {
    const banner = document.createElement('div')
    banner.className = 'verdict good'
    banner.textContent = 'TOKEN CHAIN · VERIFIED'
    document.querySelector('#app')?.append(banner)
  })
  const classed = await page.evaluate(collectVerdicts, VERDICT_WORDS)
  expect(classed.stylingViolations.map((violation) => violation.where)).toContain('div.verdict.good')
  expect(classed.wordViolations.map((violation) => violation.word)).toContain('VERIFIED')

  // And again with no class at all, only an inline colour — the class list is not the detector.
  await page.goto('/')
  await page.evaluate(() => {
    const banner = document.createElement('div')
    banner.id = 'rogue-banner'
    banner.style.color = 'var(--alarm)'
    banner.textContent = 'REDEMPTION ACCEPTED'
    document.querySelector('#app')?.append(banner)
  })
  const inline = await page.evaluate(collectVerdicts, VERDICT_WORDS)
  expect(inline.stylingViolations.map((violation) => violation.where)).toContain('div#rogue-banner')
  expect(inline.wordViolations.map((violation) => violation.word)).toContain('ACCEPTED')

  // A marker nobody has ever mutated must fail coverage rather than satisfy it.
  await page.goto('/')
  await page.evaluate(() => {
    const banner = document.createElement('div')
    banner.setAttribute('data-verdict', 'ghost')
    banner.textContent = 'GHOST CHECK · VERIFIED'
    document.querySelector('#app')?.append(banner)
  })
  const ghost = await page.evaluate(collectVerdicts, VERDICT_WORDS)
  expect(ghost.markers).toContain('ghost')
  expect(uncoveredMarkers(ghost.markers, manifest)).toEqual(['ghost'])
})
