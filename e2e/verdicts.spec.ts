import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.js'
import { collectVerdicts, MEASUREMENT_PATTERN, phantomMarkers, uncoveredMarkers, VERDICT_WORDS, type Manifest, type VerdictScan } from './verdict-scan.js'
import { readObservations, type Observation } from './observed.js'
import { selfReadingKills, unobservedKills } from './coverage.js'

const manifest = JSON.parse(readFileSync(new URL('./verdict-mutations.json', import.meta.url), 'utf8')) as Manifest
const SCAN_OPTIONS = { words: VERDICT_WORDS, measurement: MEASUREMENT_PATTERN }

// EVERY control on this page, and every option of each one. This list is the DENOMINATOR the two
// coverage tests below enumerate over, so a state that no control here reaches is a state their
// rules are never applied to. Per control, not the cross-product: four modes plus four commands
// plus one disclosure is nine visits per pass, not the product of them.
//
//   modes        — four radio options, each a different protocol fixture
//   client roster — three radio options sizing the per-client-key fixture. They are disabled
//                  outside the mode they parameterise, so they are walked INSIDE that mode; for
//                  the other three modes the control changes nothing that renders, which is a
//                  statement about this page rather than a skip taken for convenience
//   commands     — four buttons, walked in order and skipped while disabled
//   disclosures  — the wire-values <details>, whose contents do not render at all while it is
//                  closed, so the entire RFC 9578 wire block — five measurement markers — was
//                  outside the walked set until this control was added to it
//
// Nothing else on the page changes what renders: the ledger bodies are scrollable regions rather
// than controls, and the topbar and source links navigate away.
const MODES: Array<{ name: string; label: RegExp; clients?: string[] }> = [
  { name: 'private', label: /Private issuance/ },
  { name: 'unblinded', label: /BROKEN: remove blinding/ },
  { name: 'partitioned', label: /BROKEN: per-client published key/, clients: ['2 clients', '3 clients', '4 clients'] },
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
    for (const clients of mode.clients ?? [null]) {
      if (clients !== null) {
        await page.getByLabel(clients).check()
        await scan(`${prefix}${mode.name}: ${clients} selected`)
      }
      const at = clients === null ? '' : ` at ${clients}`
      for (const step of STEPS) {
        const control = page.getByRole('button', { name: step })
        if (!(await control.isEnabled())) continue
        await control.click()
        await scan(`${prefix}${mode.name}: ${step}${at}`)
      }
      for (const disclosure of DISCLOSURES) {
        await page.getByText(disclosure.summary).click()
        await scan(`${prefix}${mode.name}: ${disclosure.name} open${at}`)
        await page.getByText(disclosure.summary).click()
        await scan(`${prefix}${mode.name}: ${disclosure.name} closed${at}`)
      }
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

// A mention of a marker is not an assertion of it, and this test used to enforce a MENTION.
// It read the killing test's source and asked whether the string `expectVerdict(page, '<marker>'`
// appeared inside it, which three different edits satisfy while asserting nothing: comment the
// call out, move it to a different test in the same file, or keep it and feed it values read off
// the marker it is asserting. The first two are answered here by evidence from the run itself —
// the helpers record every (spec, test, marker) pair they EXECUTE, and this test reads that sink
// back. The third is a question about the argument rather than the call, and is answered by the
// provenance rule below it.
//
// Playwright runs tests in worker processes, so the sink is files under test-results/ rather than
// a module-level Set, it is cleared in e2e/global-setup.ts before the first test, and this file
// runs in its own `verdict-coverage` project whose `dependencies:` make it run last. That is also
// why a file filter cannot hollow it out: a dependency project runs its whole file list, so
// `npx playwright test e2e/verdicts.spec.ts` — the command the CI job of the same name runs —
// still runs e2e/claims.spec.ts first and still judges it.
test('every recorded kill was EXECUTED at runtime on the marker it names', async ({ page }) => {
  const helperSource = readFileSync(new URL('./expect-verdict.ts', import.meta.url), 'utf8')
  expect(helperSource, 'the shared helper must assert the state attribute, not only the words').toContain("toHaveAttribute('data-result'")
  expect(helperSource, 'the shared helper must assert the palette the marker paints itself in').toContain('paintOf')

  const observations = readObservations()
  expect(observations.filter((entry) => entry.kind === 'assert'), 'the run recorded no helper call at all, so nothing below could have been observed').not.toEqual([])
  expect(unobservedKills(manifest, observations), 'recorded mutations whose killing test never executed the helper against the marker it names').toEqual([])

  // The provenance rule needs to know what "reading this marker" looks like, and that list is
  // DISCOVERED from the rendered page — the marker's own attribute selector plus every id on it
  // or an ancestor of it — rather than typed into the rule, where it would go stale exactly when
  // the page changed.
  const ids: Record<'markers' | 'claims', Map<string, Set<string>>> = { markers: new Map(), claims: new Map() }
  await walkEveryState(page, (_state, scan) => {
    for (const [family, entries] of [['markers', scan.markerIds], ['claims', scan.claimIds]] as const) {
      for (const [marker, path] of entries) {
        const known = ids[family].get(marker) ?? new Set<string>()
        path.forEach((id) => known.add(id))
        ids[family].set(marker, known)
      }
    }
  })
  const attributeOf = { markers: 'data-verdict', claims: 'data-claim' }
  const sources = new Map<string, string>()
  const sourceOf = (spec: string): string => {
    if (!sources.has(spec)) sources.set(spec, readFileSync(new URL(`../${spec}`, import.meta.url), 'utf8'))
    return sources.get(spec) as string
  }
  expect(
    selfReadingKills(manifest, sourceOf, (family, marker) => [`[${attributeOf[family]}="${marker}"]`, `'${marker}'`, ...(ids[family].get(marker) ?? [])]),
    'recorded mutations whose killing test builds its expectation out of the marker it is asserting, which no mutation of that marker can falsify',
  ).toEqual([])
})

// The three escapes, permanently. Each one was demonstrated against this lab by an auditor and
// each is replayed here against the rules themselves, so "it bites" is a check that re-runs rather
// than a transcript from the day it was written.
test('the coverage rules bite: a commented-out call, a call in another test, and an expectation read off the marker itself', () => {
  const spec = 'e2e/claims.spec.ts'
  const title = 'the killing test'
  const fixture = {
    markers: { linkage: { renders: 'the collusion check', mutations: [{ id: 'F1', source: '', mutation: '', killedBy: { spec, test: title }, observed: '' }] } },
    claims: {},
  } as unknown as Manifest
  const ran: Observation = { kind: 'test', spec, test: title }
  const executed: Observation = { kind: 'assert', spec, test: title, family: 'markers', helper: 'expectVerdict', marker: 'linkage' }

  expect(unobservedKills(fixture, [ran, executed]), 'a pair that really ran is the clean case').toEqual([])
  expect(unobservedKills(fixture, [ran]).join(' '), 'commented out: the test ran, the assertion did not').toContain('ran without ever executing')
  expect(unobservedKills(fixture, [ran, { ...executed, test: 'some other test in the same file' }]).join(' '), 'satisfied from elsewhere in the file: the pair is per test, not per file').toContain('ran without ever executing')
  expect(unobservedKills(fixture, [executed]).join(' '), 'a killing test that did not run cannot be judged, and is not clean').toContain('did not run in this session')

  const reads = (): string[] => ['[data-verdict="linkage"]', "'linkage'", '#link-verdict', '#app']
  const tautological = `test('${title}', async ({ page }) => {
    const shown = page.locator('[data-verdict="linkage"]')
    await expectVerdict(page, 'linkage', { text: (await shown.textContent()) ?? '', result: 'alarm' })
  })`
  const crossChecked = `test('${title}', async ({ page }) => {
    const ledgerKeys = await page.locator('#origin-ledger code').allTextContents()
    await expectVerdict(page, 'linkage', { text: 'COLLUSION CHECK · LINKED: BLINDING WAS REMOVED', result: 'alarm' })
    expect(ledgerKeys).not.toEqual([])
  })`
  expect(selfReadingKills(fixture, () => tautological, reads).join(' '), 'an expectation read off the marker under assertion').toContain('builds its expectation from')
  expect(selfReadingKills(fixture, () => crossChecked, reads), 'reading a DIFFERENT region is how the honest oracles here work and must stay legal').toEqual([])
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
