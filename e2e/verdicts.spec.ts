import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { collectVerdicts, MEASUREMENT_PATTERN, phantomMarkers, uncoveredMarkers, VERDICT_WORDS, type Family, type Manifest, type VerdictScan } from './verdict-scan.js'

const manifest = JSON.parse(readFileSync(new URL('./verdict-mutations.json', import.meta.url), 'utf8')) as Manifest
const SCAN_OPTIONS = { words: VERDICT_WORDS, measurement: MEASUREMENT_PATTERN }

// EVERY control on this page, and every option of each one. This list is the DENOMINATOR the two
// coverage tests below enumerate over, so a state that no control here reaches is a state their
// rules are never applied to. Per control, not the cross-product: four modes plus four commands
// plus one disclosure is nine visits per pass, not the product of them.
//
//   modes        — four radio options, each a different protocol fixture
//   commands     — four buttons, walked in order and skipped while disabled
//   disclosures  — the wire-values <details>, whose contents do not render at all while it is
//                  closed, so the entire RFC 9578 wire block — five measurement markers — was
//                  outside the walked set until this control was added to it
//
// Nothing else on the page changes what renders: the ledger bodies are scrollable regions rather
// than controls, and the topbar and source links navigate away.
const MODES = [
  { name: 'private', label: /Private issuance/ },
  { name: 'unblinded', label: /BROKEN: remove blinding/ },
  { name: 'partitioned', label: /BROKEN: per-client published key/ },
  { name: 'substituted', label: /BROKEN: unpublished issuer key/ },
]
const STEPS = ['1. Issue token', '2. Redeem at origin', '3. Try to link ledgers', 'Replay token']
const DISCLOSURES = [{ name: 'wire values', summary: 'Inspect the real wire values and scope' }]

/** Drives every reachable protocol state and hands the caller a fresh scan of each one. */
async function walkEveryState(page: Page, visit: (state: string, scan: VerdictScan) => void): Promise<void> {
  const scan = async (state: string): Promise<void> => visit(state, await page.evaluate(collectVerdicts, SCAN_OPTIONS))
  const driveMode = async (mode: (typeof MODES)[number], prefix: string): Promise<void> => {
    await page.getByLabel(mode.label).check()
    await scan(`${prefix}${mode.name}: selected`)
    for (const step of STEPS) {
      const control = page.getByRole('button', { name: step })
      if (!(await control.isEnabled())) continue
      await control.click()
      await scan(`${prefix}${mode.name}: ${step}`)
    }
    for (const disclosure of DISCLOSURES) {
      await page.getByText(disclosure.summary).click()
      await scan(`${prefix}${mode.name}: ${disclosure.name} open`)
      await page.getByText(disclosure.summary).click()
      await scan(`${prefix}${mode.name}: ${disclosure.name} closed`)
    }
  }

  await page.goto('/')
  await scan('initial')
  for (const mode of MODES) {
    await page.goto('/')
    await driveMode(mode, '')
  }

  // Switching modes in place is a distinct set of states: prior verdicts are retired rather than
  // replaced, and a fresh load never reaches them.
  await page.goto('/')
  for (const mode of MODES) await driveMode(mode, 'retired -> ')
}

test('every verdict and every measurement the page renders has a mutation that forced it false', async ({ page }) => {
  const verdicts = new Set<string>()
  const claims = new Set<string>()
  const nested: string[] = []
  await walkEveryState(page, (state, scan) => {
    scan.markers.forEach((marker) => verdicts.add(marker))
    scan.claims.forEach((marker) => claims.add(marker))
    scan.nested.forEach((where) => nested.push(`${state}: verdict ${where}`))
    scan.nestedClaims.forEach((where) => nested.push(`${state}: claim ${where}`))
  })
  expect(verdicts.size, 'the walk reached no verdict markers at all').toBeGreaterThan(0)
  expect(claims.size, 'the walk reached no measurement markers at all').toBeGreaterThan(0)
  expect(nested, 'a marker nested inside another of its own kind hides the inner outcome from the scan').toEqual([])
  expect(uncoveredMarkers(verdicts, manifest.markers), 'rendered verdicts with no recorded mutation in e2e/verdict-mutations.json').toEqual([])
  expect(phantomMarkers(verdicts, manifest.markers), 'verdicts claimed by the manifest that no reachable state renders').toEqual([])
  // Measurements are in the same loop on the same terms: a rendered number with no mutation fails
  // the build, and a record naming a measurement the page no longer renders fails too.
  expect(uncoveredMarkers(claims, manifest.claims), 'rendered measurements with no recorded mutation in e2e/verdict-mutations.json').toEqual([])
  expect(phantomMarkers(claims, manifest.claims), 'measurements claimed by the manifest that no reachable state renders').toEqual([])
})

test('no verdict and no measurement is rendered outside a marker in any reachable state', async ({ page }) => {
  const styling: string[] = []
  const words: string[] = []
  const measurements: string[] = []
  await walkEveryState(page, (state, scan) => {
    scan.stylingViolations.forEach((violation) => styling.push(`${state}: ${violation.where} — ${violation.reason} — "${violation.text}"`))
    scan.wordViolations.forEach((violation) => words.push(`${state}: ${violation.where} — ${violation.word} — "${violation.text}"`))
    scan.measurementViolations.forEach((violation) => measurements.push(`${state}: ${violation.region} — ${violation.where} — ${violation.kind} — "${violation.text}"`))
  })
  expect(styling, 'verdict styling outside any [data-verdict] marker').toEqual([])
  expect(words, 'verdict vocabulary outside any [data-verdict] marker').toEqual([])
  expect(measurements, 'a number rendered in a result region outside any [data-verdict] or [data-claim] marker').toEqual([])
})

// A mention of a marker is not an assertion of it, and a text assertion is not an assertion of its
// STATE. Every original kill in this lab was recorded from `getByText(...)` alone, so a mutation
// that flipped the words while leaving the pass styling behind would have been counted as
// evidence. Every mutation now names the test that killed it, and that test has to assert the
// marker through the shared helper, which asserts text, data-result and painted palette together.
test('every recorded kill goes through the helper that asserts text and state together', () => {
  const helperSource = readFileSync(new URL('./expect-verdict.ts', import.meta.url), 'utf8')
  expect(helperSource, 'the shared helper must assert the state attribute, not only the words').toContain("toHaveAttribute('data-result'")
  expect(helperSource, 'the shared helper must assert the palette the marker paints itself in').toContain('paintOf')

  const sources = new Map<string, string>()
  const sourceOf = (spec: string): string => {
    if (!sources.has(spec)) sources.set(spec, readFileSync(new URL(`../${spec}`, import.meta.url), 'utf8'))
    return sources.get(spec) as string
  }
  const bodyOfTest = (source: string, title: string): string | null => {
    const start = source.indexOf(`test('${title}'`)
    if (start === -1) return null
    const next = source.indexOf('\ntest(', start + 1)
    return source.slice(start, next === -1 ? source.length : next)
  }

  const problems: string[] = []
  const families: Array<[Family, string]> = [[manifest.markers, 'expectVerdict'], [manifest.claims, 'expectClaim']]
  for (const [entries, helper] of families) {
    for (const [marker, entry] of Object.entries(entries)) {
      for (const mutation of entry.mutations) {
        const killedBy = mutation.killedBy
        if (!killedBy?.spec || !killedBy?.test) {
          problems.push(`${marker}/${mutation.id}: no killedBy { spec, test } recorded`)
          continue
        }
        const body = bodyOfTest(sourceOf(killedBy.spec), killedBy.test)
        if (body === null) {
          problems.push(`${marker}/${mutation.id}: ${killedBy.spec} has no test named "${killedBy.test}"`)
          continue
        }
        if (!new RegExp(`${helper}\\(page, '${marker}'`).test(body)) {
          problems.push(`${marker}/${mutation.id}: "${killedBy.test}" never calls ${helper}(page, '${marker}', …), so the recorded kill proves the words alone`)
        }
      }
    }
  }
  expect(problems, 'recorded mutations whose killing test does not assert the marker through the shared text-and-state helper').toEqual([])
})

test('the coverage checks bite: an unmarked banner, an unmarked number and an unregistered marker are all caught', async ({ page }) => {
  await page.goto('/')
  const clean = await page.evaluate(collectVerdicts, SCAN_OPTIONS)
  expect(clean.stylingViolations, 'baseline for the negative control must be clean').toEqual([])
  expect(clean.wordViolations, 'baseline for the negative control must be clean').toEqual([])
  expect(clean.measurementViolations, 'baseline for the negative control must be clean').toEqual([])

  // A careless builder adds a banner the way the page's own CSS invites: verdict class, verdict
  // word, no marker. Both detectors have to fire, or marking verdicts is decoration.
  await page.evaluate(() => {
    const banner = document.createElement('div')
    banner.className = 'verdict good'
    banner.textContent = 'TOKEN CHAIN · VERIFIED'
    document.querySelector('#app')?.append(banner)
  })
  const classed = await page.evaluate(collectVerdicts, SCAN_OPTIONS)
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
  const inline = await page.evaluate(collectVerdicts, SCAN_OPTIONS)
  expect(inline.stylingViolations.map((violation) => violation.where)).toContain('div#rogue-banner')
  expect(inline.wordViolations.map((violation) => violation.word)).toContain('ACCEPTED')

  // A rendered number is neither of those: no verdict word, no verdict colour, and the easier
  // mistake to make, because a number does not look like a claim. A digit with a unit and a bare
  // integer in a result region both have to fire.
  await page.goto('/')
  await page.evaluate(() => {
    const sizes = document.createElement('p')
    sizes.id = 'rogue-size'
    sizes.textContent = 'TokenResponse grew to 1,632 B on this run'
    document.querySelector('#issuer-ledger')?.append(sizes)
    const bare = document.createElement('span')
    bare.id = 'rogue-count'
    bare.textContent = '42'
    document.querySelector('#origin-ledger')?.append(bare)
  })
  const numbers = await page.evaluate(collectVerdicts, SCAN_OPTIONS)
  expect(numbers.measurementViolations.map((violation) => `${violation.where} ${violation.kind}`)).toEqual([
    'p#rogue-size measurement "1,632 B"',
    'span#rogue-count bare integer "42"',
  ])

  // A marker nobody has ever mutated must fail coverage rather than satisfy it — in both families.
  await page.goto('/')
  await page.evaluate(() => {
    const banner = document.createElement('div')
    banner.setAttribute('data-verdict', 'ghost')
    banner.textContent = 'GHOST CHECK · VERIFIED'
    document.querySelector('#app')?.append(banner)
    const measurement = document.createElement('span')
    measurement.setAttribute('data-claim', 'ghost-size')
    measurement.textContent = '7 bytes'
    document.querySelector('#issuer-ledger')?.append(measurement)
  })
  const ghost = await page.evaluate(collectVerdicts, SCAN_OPTIONS)
  expect(ghost.markers).toContain('ghost')
  expect(uncoveredMarkers(ghost.markers, manifest.markers)).toEqual(['ghost'])
  expect(ghost.claims).toContain('ghost-size')
  expect(uncoveredMarkers(ghost.claims, manifest.claims)).toEqual(['ghost-size'])
})
