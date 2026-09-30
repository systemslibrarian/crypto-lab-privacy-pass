// Verdict coverage is derived from the RENDERED PAGE, never from a list an author keeps.
//
// Two detectors live here:
//   collectVerdicts()  — walks the live DOM and reports every [data-verdict] and [data-claim]
//                        marker it finds, plus every place the page renders a verdict OR a
//                        measurement WITHOUT one.
//   uncovered()        — set difference against e2e/verdict-mutations.json, so a marker that
//                        no mutation has ever killed fails the gate.
//
// The second detector exists because marking verdicts is the easy half. A careless builder
// adds a raw banner later, and nothing in an author-maintained list would ever notice.
//
// Measurements are in the same loop on the same terms, because a rendered NUMBER is exactly as
// unchecked as a rendered verdict and is the easier mistake to make — a number does not look
// like a claim. `1,632 B`, `52 bytes`, a bare `147` in a ledger: none of them carry a verdict
// word and none of them are painted in a verdict colour, so the two original detectors are blind
// to all of them.

/** All-caps tokens that only ever appear on this page as the outcome of a check. */
export const VERDICT_WORDS = [
  'VERIFIED', 'REJECTED', 'REFUSED', 'ACCEPTED', 'LINKED', 'PARTITIONED', 'ALARM',
  'VALID', 'INVALID', 'FAILED', 'PASSED', 'SECURE', 'FORGED', 'TAMPERED', 'MATCH', 'MATCHED',
]

/**
 * A number a reader would read as a measurement: digits carrying a unit, anywhere in a result
 * region. The lookbehind keeps it off the inside of hex blobs, where "…9b" is not "9 bytes".
 * Bare integers are caught separately, as the whole text of a leaf (this page's stats-grid case
 * is the truncated key id in the issuer ledger).
 *
 * THE UNIT SET WAS WIDENED ON 2026-09-30, and what it did NOT gain is the part worth reading.
 * It accepted only byte, bit, count and duration units under a second, so a page could render
 * "1,380 CPU core-years", "2.3 days" or "$13 trillion" and the rule saw no measurement at all. A
 * fleet survey found 248 COMPUTED figures in those forms across 56 labs — and 1,005 literal
 * ones, four for every computed one, which is why this was widened here rather than rolled out.
 *
 * `2^n` IS DELIBERATELY NOT A UNIT. `2^90` is exponent notation for a magnitude, not ninety of
 * something, and the fleet carries 881 literal ones — almost all security levels. The honest
 * limit is worth stating rather than implying: at scan time the page is RENDERED, so a literal
 * `2^43` and a computed `2^${bits}` are the same bytes and no shape separates them. What does
 * separate them is the marker — a computed magnitude the page stands behind carries
 * `data-claim`, and this walk skips those before it reaches the pattern. So a computed exponent
 * that matters is already covered, and an uncovered one is prose.
 */
export const MEASUREMENT_PATTERN =
  '(?<![\\w.])\\d[\\d,]*(?:\\.\\d+)?\\s*(?:B|KB|MB|bits?|bytes?|ops?|operations?|ms|s|\u00d7|x' +
  '|CPU-years?|core-years?|GPU-years?|years?|months?|weeks?|days?|hours?|minutes?' +
  '|trillion|billion|million|quadrillion)\\b'

/** Exponent notation, excluded from the rule above by shape. See the note on it. */
export const EXPONENT_PATTERN = '\\b2\\s*\\^\\s*\\d+'

export type VerdictScan = {
  markers: string[]
  claims: string[]
  /** Per marker, every DOM id on the marker element or an ancestor of it, as `#id` selectors.
   *  Read off the page so the "did this expectation come from the marker itself?" rule in
   *  e2e/coverage.ts has a discovered list rather than one typed into the rule. */
  markerIds: Array<[string, string[]]>
  claimIds: Array<[string, string[]]>
  nested: string[]
  nestedClaims: string[]
  stylingViolations: Array<{ where: string; reason: string; text: string }>
  wordViolations: Array<{ where: string; word: string; text: string }>
  measurementViolations: Array<{ where: string; region: string; kind: string; text: string }>
  /* Every `data-cited` id the page renders. A figure the page QUOTES is exempt from
     the measurement rule, but only structurally: the element has to name the
     citedClaims entry it comes from, and verdicts.spec fails on an id that entry
     list does not contain. A text allowlist would exempt by appearance and drift
     the moment the wording changed. */
  citedIds: string[]
}

/**
 * Runs inside the page. Must stay self-contained: Playwright serializes it, so it may not
 * close over anything from this module.
 */
export function collectVerdicts(options: { words: string[]; measurement: string; exponent: string }): VerdictScan {
  const words = options.words
  /* Built inside the evaluated scope on purpose: this function is serialised into the page,
     so a module-scope constant would be undefined by the time it runs there. */
  const exponent = new RegExp(options.exponent)
  const describe = (element: Element | null): string => {
    if (!element) return '(detached text node)'
    const id = element.id ? `#${element.id}` : ''
    const cls = typeof element.className === 'string' && element.className ? `.${element.className.trim().split(/\s+/).join('.')}` : ''
    return `${element.tagName.toLowerCase()}${id}${cls}`
  }

  // Resolve the palette tokens the page uses to mean "this check passed / this check failed".
  const probe = document.createElement('span')
  probe.style.display = 'none'
  document.body.append(probe)
  const resolve = (token: string): string => {
    probe.style.color = ''
    probe.style.color = `var(${token})`
    return getComputedStyle(probe).color
  }
  const verdictColors = new Set([resolve('--good'), resolve('--alarm')])
  probe.remove()
  verdictColors.delete('')

  // Every id a reader could address this element through: its own, and every ancestor's, because
  // reading an ancestor's text reads the marker's text with it.
  const idPath = (element: Element): string[] => {
    const ids: string[] = []
    for (let current: Element | null = element; current; current = current.parentElement) {
      if (current.id) ids.push(`#${current.id}`)
    }
    return ids
  }

  const markers: string[] = []
  const markerIds: Array<[string, string[]]> = []
  const nested: string[] = []
  document.querySelectorAll('[data-verdict]').forEach((element) => {
    const name = element.getAttribute('data-verdict') ?? ''
    markers.push(name)
    markerIds.push([name, idPath(element)])
    if (element.parentElement?.closest('[data-verdict]')) nested.push(describe(element))
  })

  const claims: string[] = []
  const claimIds: Array<[string, string[]]> = []
  const nestedClaims: string[] = []
  document.querySelectorAll('[data-claim]').forEach((element) => {
    const name = element.getAttribute('data-claim') ?? ''
    claims.push(name)
    claimIds.push([name, idPath(element)])
    if (element.parentElement?.closest('[data-claim]')) nestedClaims.push(describe(element))
  })

  const ownsText = (element: Element): boolean =>
    [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length > 0)

  const stylingViolations: VerdictScan['stylingViolations'] = []
  document.querySelectorAll('body *').forEach((element) => {
    if (element.closest('[data-verdict]')) return
    if (!ownsText(element)) return
    if (!(element as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) return
    const style = getComputedStyle(element)
    const text = (element.textContent ?? '').trim().slice(0, 90)
    if (verdictColors.has(style.color)) {
      stylingViolations.push({ where: describe(element), reason: `text painted in a verdict colour (${style.color})`, text })
      return
    }
    for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
      const width = Number.parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`))
      const color = style.getPropertyValue(`border-${side.toLowerCase()}-color`)
      if (width > 0 && verdictColors.has(color)) {
        stylingViolations.push({ where: describe(element), reason: `border-${side.toLowerCase()} painted in a verdict colour (${color})`, text })
        return
      }
    }
  })

  const wordViolations: VerdictScan['wordViolations'] = []
  const pattern = new RegExp(`\\b(${words.join('|')})\\b`)
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode
    const text = (node.nodeValue ?? '').trim()
    const hit = pattern.exec(text)
    if (!hit) continue
    const parent = node.parentElement
    if (parent?.closest('[data-verdict]')) continue
    wordViolations.push({ where: describe(parent), word: hit[1], text: text.slice(0, 90) })
  }

  // Result regions are the elements the page WRITES RESULTS INTO. Inside one, a number must sit
  // in a marker. Text inside a [data-claim] is exempt because that IS the marker; text inside a
  // [data-verdict] is exempt unless that verdict is itself declared a region — the link map is a
  // verdict whose body renders a count, and its count still has to be marked.
  const citedIds: string[] = []
  document.querySelectorAll('[data-cited]').forEach((element) => {
    const id = element.getAttribute('data-cited') ?? ''
    if (id) citedIds.push(id)
  })

  const measurement = new RegExp(options.measurement, 'i')
  const bareInteger = /^\d[\d,]*$/
  const measurementViolations: VerdictScan['measurementViolations'] = []
  document.querySelectorAll('[data-result-region]').forEach((region) => {
    const label = region.getAttribute('data-result-region') ?? describe(region)
    const regionWalker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT)
    while (regionWalker.nextNode()) {
      const parent = regionWalker.currentNode.parentElement
      if (!parent) continue
      if (parent.closest('[data-claim]')) continue
      /* A quoted figure is not a measurement this page made. It is exempt only
         because it names the citation it came from; verdicts.spec checks that the
         name resolves. */
      if (parent.closest('[data-cited]')) continue
      const marker = parent.closest('[data-verdict]')
      if (marker && !marker.hasAttribute('data-result-region')) continue
      const text = (regionWalker.currentNode.nodeValue ?? '').trim()
      if (!text) continue
      const hit = measurement.exec(text)
      /* Exponent notation is not a measurement, and `2^90` would otherwise be read as ninety
         of whatever word follows it. Skipped by shape, never by an allowlist of numbers. */
      if (hit && exponent.test(text)) continue
      if (hit) {
        measurementViolations.push({ where: describe(parent), region: label, kind: `measurement "${hit[0]}"`, text: text.slice(0, 90) })
        continue
      }
      if (bareInteger.test(text) && parent.children.length === 0) {
        measurementViolations.push({ where: describe(parent), region: label, kind: `bare integer "${text}"`, text: text.slice(0, 90) })
      }
    }
  })

  return { markers, claims, markerIds, claimIds, nested, nestedClaims, stylingViolations, wordViolations, measurementViolations, citedIds }
}

export type Mutation = { id: string; source: string; mutation: string; killedBy: { spec: string; test: string }; observed: string }
export type Family = Record<string, { renders: string; mutations: Mutation[] }>
export type Manifest = {
  markers: Family
  claims: Family
  /** Figures the page QUOTES, each with the source that says it. Not mutation records:
   *  a cited number cannot be killed by changing it, which is why it is a separate key. */
  citedClaims: Array<{ id: string; text: string; source: string }>
}

/** Markers the page renders that no recorded mutation has ever forced false. */
export const uncoveredMarkers = (markers: Iterable<string>, family: Family): string[] =>
  [...new Set(markers)].filter((marker) => (family[marker]?.mutations.length ?? 0) === 0).sort()

/** Markers the manifest claims exist but the page never renders in any reachable state. */
export const phantomMarkers = (markers: Iterable<string>, family: Family): string[] => {
  const rendered = new Set(markers)
  return Object.keys(family).filter((marker) => !rendered.has(marker)).sort()
}
