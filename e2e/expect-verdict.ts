// A marker's WORDS and its STATE are one claim, so one helper asserts both.
//
// Before this file existed, every recorded kill was a text assertion: `getByText('... VERIFIED')`.
// A mutation that flipped the sentence while leaving the pass styling in place would have been
// recorded as a kill, and the marker would have gone on claiming pass in every way a reader can
// see except the sentence. So `expectVerdict` asserts the text, the `data-result` attribute the
// page writes beside it, AND the palette the element actually paints itself in — one call, one
// claim, all of it forced false by any mutation that is allowed to count.
//
// e2e/verdicts.spec.ts enforces that every mutation in e2e/verdict-mutations.json is killed by a
// test that goes through one of these two helpers. A text-only assertion cannot be recorded.
import { expect, type Locator, type Page } from '@playwright/test'

export type Result = 'good' | 'alarm' | 'neutral'

/**
 * Runs inside the page: which verdict palette, if any, this element paints ITSELF in.
 * Serialized by Playwright, so it may not close over anything in this module.
 */
export function paintOf(element: Element): string {
  const probe = document.createElement('span')
  probe.style.display = 'none'
  document.body.append(probe)
  const resolve = (token: string): string => {
    probe.style.color = ''
    probe.style.color = `var(${token})`
    return getComputedStyle(probe).color
  }
  const palette = new Map([[resolve('--good'), 'good'], [resolve('--alarm'), 'alarm']])
  probe.remove()
  const style = getComputedStyle(element)
  const painted = new Set<string>()
  const textColor = palette.get(style.color)
  if (textColor) painted.add(textColor)
  for (const side of ['top', 'right', 'bottom', 'left']) {
    if (Number.parseFloat(style.getPropertyValue(`border-${side}-width`)) <= 0) continue
    const borderColor = palette.get(style.getPropertyValue(`border-${side}-color`))
    if (borderColor) painted.add(borderColor)
  }
  return [...painted].sort().join('+') || 'none'
}

/** Asserts a verdict marker's text, its data-result, and its palette together. */
export async function expectVerdict(page: Page, id: string, claim: { text: string | RegExp; result: Result }): Promise<void> {
  const marker: Locator = page.locator(`[data-verdict="${id}"]`)
  await expect(marker, `verdict "${id}" is not rendered`).toBeVisible()
  await expect(marker, `verdict "${id}" text`).toContainText(claim.text)
  await expect(marker, `verdict "${id}" data-result`).toHaveAttribute('data-result', claim.result)
  await expect
    .poll(() => marker.evaluate(paintOf), { message: `verdict "${id}" palette must agree with data-result="${claim.result}"` })
    .toBe(claim.result === 'neutral' ? 'none' : claim.result)
}

/**
 * Asserts a measurement marker's published value AND that the reader can see it.
 * `value` is what the oracle derived for itself; the marker must both publish it as `data-value`
 * and print it in the sentence, so a number cannot drift from the attribute that is tested.
 */
export async function expectClaim(page: Page, id: string, claim: { value: string | number; text?: string | RegExp }): Promise<void> {
  const marker: Locator = page.locator(`[data-claim="${id}"]`)
  await expect(marker, `claim "${id}" is not rendered`).toBeVisible()
  await expect(marker, `claim "${id}" data-value`).toHaveAttribute('data-value', String(claim.value))
  await expect(marker, `claim "${id}" must print the value it publishes`).toContainText(String(claim.value))
  if (claim.text !== undefined) await expect(marker, `claim "${id}" text`).toContainText(claim.text)
}
