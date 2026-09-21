// Verdict coverage is derived from the RENDERED PAGE, never from a list an author keeps.
//
// Two detectors live here:
//   collectVerdicts()  — walks the live DOM and reports every [data-verdict] marker it finds,
//                        plus every place the page renders a verdict WITHOUT one.
//   uncovered()        — set difference against e2e/verdict-mutations.json, so a marker that
//                        no mutation has ever killed fails the gate.
//
// The second detector exists because marking verdicts is the easy half. A careless builder
// adds a raw banner later, and nothing in an author-maintained list would ever notice.

/** All-caps tokens that only ever appear on this page as the outcome of a check. */
export const VERDICT_WORDS = [
  'VERIFIED', 'REJECTED', 'REFUSED', 'ACCEPTED', 'LINKED', 'PARTITIONED', 'ALARM',
  'VALID', 'INVALID', 'FAILED', 'PASSED', 'SECURE', 'FORGED', 'TAMPERED', 'MATCH', 'MATCHED',
]

export type VerdictScan = {
  markers: string[]
  nested: string[]
  stylingViolations: Array<{ where: string; reason: string; text: string }>
  wordViolations: Array<{ where: string; word: string; text: string }>
}

/**
 * Runs inside the page. Must stay self-contained: Playwright serializes it, so it may not
 * close over anything from this module.
 */
export function collectVerdicts(words: string[]): VerdictScan {
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

  const markers: string[] = []
  const nested: string[] = []
  document.querySelectorAll('[data-verdict]').forEach((element) => {
    markers.push(element.getAttribute('data-verdict') ?? '')
    if (element.parentElement?.closest('[data-verdict]')) nested.push(describe(element))
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

  return { markers, nested, stylingViolations, wordViolations }
}

export type Manifest = { markers: Record<string, { renders: string; mutations: Array<{ id: string }> }> }

/** Markers the page renders that no recorded mutation has ever forced false. */
export const uncoveredMarkers = (markers: Iterable<string>, manifest: Manifest): string[] =>
  [...new Set(markers)].filter((marker) => (manifest.markers[marker]?.mutations.length ?? 0) === 0).sort()

/** Markers the manifest claims exist but the page never renders in any reachable state. */
export const phantomMarkers = (markers: Iterable<string>, manifest: Manifest): string[] => {
  const rendered = new Set(markers)
  return Object.keys(manifest.markers).filter((marker) => !rendered.has(marker)).sort()
}
