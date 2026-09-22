import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.js'
import { expectClaim, expectVerdict } from './expect-verdict.js'
import { batchVectors, singleVectors } from '../src/kat/rfc9497.js'
import { issuanceVectors } from '../src/kat/rfc9578.js'

// The RFC 9578 type 0x0001 field list, written out here rather than imported from src/: an oracle
// that reuses the implementation's own arithmetic cannot disagree with it. Every byte count the
// page prints is re-derived from these fields, so a literal in the page cannot be right by luck.
// The known-answer corpus below is imported instead, and the distinction is the point: the
// arithmetic under test is the COUNT, so the oracle may not import the count — it imports the
// vectors and counts them itself.
const TOKEN_TYPE = 2
const P384_POINT = 1 + 48 // compressed: one tag byte plus one coordinate
const P384_SCALAR = 48
const SHA256_DIGEST = 32
const NONCE = 32
const AUTHENTICATOR = 48
const TOKEN_REQUEST = TOKEN_TYPE + 1 + P384_POINT
const TOKEN_RESPONSE = P384_POINT + P384_SCALAR + P384_SCALAR
const TOKEN = TOKEN_TYPE + NONCE + SHA256_DIGEST + SHA256_DIGEST + AUTHENTICATOR

// The known-answer counter is anchored to the CORPUS, not to the page's own arithmetic. The
// oracle here used to read the two parts out of the sentence the page printed and check that they
// summed to the total the page published beside them — which is true of ANY two numbers the page
// chooses to print, a literal that disagrees with the vectors on disk included. Both parts are
// counted here from the vector arrays the unit suite iterates, so a literal in src/kat/ fails
// whether it happens to be right or is simply wrong.
const RFC9497_VECTORS = singleVectors.length + batchVectors.length
const RFC9578_VECTORS = issuanceVectors.length
const KAT_VECTORS = RFC9497_VECTORS + RFC9578_VECTORS

/** The fixture roster, in the order src/main.ts publishes keys to it. */
const PARTITION_ROSTER = ['Alice', 'Bob', 'Carol', 'Dave']

/** The hex half of a wire marker, which prints `<hex> · <n> bytes`. */
const hexOf = async (page: Page, id: string): Promise<string> =>
  ((await page.locator(`[data-claim="${id}"]`).textContent()) ?? '').split(' · ')[0].trim()

test.beforeEach(async ({ page }) => { await page.goto('/') })

test('private blind issuance redeems but gives the colluding ledgers no match', async ({ page }) => {
  await page.getByRole('button', { name: '1. Issue token' }).click()
  await expectVerdict(page, 'dleq', { text: 'DLEQ PROOF · VERIFIED', result: 'good' })
  await page.getByText('Inspect the real wire values and scope').click()
  // Each length is derived above and then checked against BOTH halves of the marker: the byte
  // count it publishes and the hex it prints. Neither one is copied from the other, and each
  // marker is named in its own call so the coverage test can see which assertion covers which.
  await expectClaim(page, 'published-key', { value: P384_POINT, text: 'bytes' })
  await expectClaim(page, 'key-id', { value: SHA256_DIGEST, text: 'bytes' })
  await expectClaim(page, 'wire-request', { value: TOKEN_REQUEST, text: 'bytes' })
  await expectClaim(page, 'wire-response', { value: TOKEN_RESPONSE, text: 'bytes' })
  await expectClaim(page, 'wire-token', { value: TOKEN, text: 'bytes' })
  for (const [id, bytes] of [['published-key', P384_POINT], ['key-id', SHA256_DIGEST], ['wire-request', TOKEN_REQUEST], ['wire-response', TOKEN_RESPONSE], ['wire-token', TOKEN]] as const) {
    expect(await hexOf(page, id), `${id} prints two hex characters per byte it publishes`).toHaveLength(bytes * 2)
  }
  // The truncated key id the issuer sorts requests by is the LAST byte of the key id it published,
  // so the oracle reads that byte off the other marker rather than repeating a number.
  const keyIdHex = await hexOf(page, 'key-id')
  await expectClaim(page, 'truncated-key-id', { value: Number.parseInt(keyIdHex.slice(-2), 16) })
  // Every number in the known-answer line is checked against the corpus it counts: the total it
  // publishes, and each of the two parts it prints. Nothing here is read back off the marker.
  await expectClaim(page, 'kat-count', {
    value: KAT_VECTORS,
    text: new RegExp(`^${KAT_VECTORS} vectors: ${RFC9497_VECTORS} RFC 9497 [^+]+\\+ ${RFC9578_VECTORS} RFC 9578\\b`),
  })
  await page.getByRole('button', { name: '2. Redeem at origin' }).click()
  await expectVerdict(page, 'redemption', { text: 'REDEMPTION · VERIFIED', result: 'good' })
  await page.getByRole('button', { name: '3. Try to link ledgers' }).click()
  await expectVerdict(page, 'linkage', { text: 'COLLUSION CHECK · NO COMPUTABLE MATCH', result: 'good' })
  await expectVerdict(page, 'link-map', { text: 'no equality-testable values cross the ledgers', result: 'good' })
  await expectClaim(page, 'computed-links', { value: 0 })
  await expect(page.locator('#link-map .computed-link')).toHaveCount(0)
})

test('removing blinding produces an explicit link alarm', async ({ page }) => {
  await page.getByLabel(/BROKEN: remove blinding/).check()
  await expect(page.getByText('Prior result retired')).toBeVisible()
  await page.getByRole('button', { name: '1. Issue token' }).click()
  // The parameter that defines the broken mode is printed from the scalar that was used, so it
  // can be asserted instead of assumed.
  await expectClaim(page, 'blind-scalar', { value: 1 })
  const issuerPoint = (await page.locator('#issuer-ledger code').textContent())?.replace(/^blinded element: /, '')
  await page.getByRole('button', { name: '3. Try to link ledgers' }).click()
  await expectVerdict(page, 'linkage', { text: 'COLLUSION CHECK · LINKED: BLINDING WAS REMOVED', result: 'alarm' })
  await expectVerdict(page, 'status', { text: 'ALARM: issuer hash-to-group value equals the origin-computable input point.', result: 'alarm' })
  await expectVerdict(page, 'link-map', { text: 'raw input point matches', result: 'alarm' })
  await expectClaim(page, 'computed-links', { value: 1 })
  await expect(page.locator('#link-map .computed-link')).toHaveCount(1)
  expect(issuerPoint).not.toBe('')
})

test('valid proofs under client-specific keys redeem and reveal partitioning', async ({ page }) => {
  await page.getByLabel(/BROKEN: per-client published key/).check()
  // The fixture is run at TWO sizes, the default and the largest it offers. At one size the claim
  // beside the number — one drawn link per partition — is not falsifiable: a literal equal to that
  // size satisfies every oracle that can be written against a single run, which is exactly how a
  // hard-coded 2 survived this marker's mutation set. Two sizes separate the reading from the
  // constant, and the assertion below fails on any literal at one of them.
  for (const clients of [2, 4]) {
    await page.getByLabel(`${clients} clients`).check()
    await page.getByRole('button', { name: '1. Issue token' }).click()
    await expectVerdict(page, 'dleq', { text: 'DLEQ PROOFS · ALL VERIFIED', result: 'good' })
    await expectVerdict(page, 'negative-claim', { text: 'does not show it published the same key to every client', result: 'alarm' })
    await page.getByRole('button', { name: '2. Redeem at origin' }).click()
    await expectVerdict(page, 'redemption', { text: 'REDEMPTIONS · ALL VERIFIED', result: 'good' })
    // The oracle counts the key buckets ITSELF, off the ledger the origin printed — a different
    // region of the page from the marker it is about to assert — and then requires one drawn line
    // per bucket, at both sizes.
    const ledgerKeys = await page.locator('#origin-ledger code').allTextContents()
    const buckets = new Set(ledgerKeys.map((entry) => entry.replace(/^token key id: /, ''))).size
    expect(buckets, `the partition fixture redeems ${clients} tokens under ${clients} different key ids`).toBe(clients)
    await page.getByRole('button', { name: '3. Try to link ledgers' }).click()
    await expectVerdict(page, 'linkage', { text: 'PROOFS VERIFIED · AND PARTITIONED', result: 'alarm' })
    await expectVerdict(page, 'link-map', { text: PARTITION_ROSTER.slice(0, clients).map((client) => `${client} key bucket`).join(' · '), result: 'alarm' })
    await expectClaim(page, 'computed-links', { value: buckets })
    await expect(page.locator('#link-map .computed-link')).toHaveCount(buckets)
  }
})

test('an unpublished issuer key aborts issuance, and the token a careless client keeps is refused', async ({ page }) => {
  await page.getByLabel(/BROKEN: unpublished issuer key/).check()
  await page.getByRole('button', { name: '1. Issue token' }).click()
  await expectVerdict(page, 'dleq', { text: 'DLEQ PROOF · REJECTED AS DESIGNED', result: 'good' })
  await expect(page.locator('#issuer-ledger')).toContainText('BROKEN unpublished-key mode')
  await expectVerdict(page, 'status', { text: 'A careful client receives no token', result: 'good' })
  const ledgerKeys = await page.locator('#issuer-ledger code').allTextContents()
  expect(ledgerKeys).toHaveLength(2)
  expect(ledgerKeys[0].replace(/^trusted key id: /, '')).not.toBe(ledgerKeys[1].replace(/^answered under: /, ''))
  await expectVerdict(page, 'redemption', { text: 'SKIPPED-CHECK TOKEN · REFUSED', result: 'good' })
  await expect(page.locator('#origin-ledger')).toContainText('Token key id does not match the issuer public key')
  await expect(page.getByRole('button', { name: '2. Redeem at origin' })).toBeDisabled()
})

test('a redeemed token cannot be replayed', async ({ page }) => {
  await page.getByRole('button', { name: '1. Issue token' }).click()
  await page.getByRole('button', { name: '2. Redeem at origin' }).click()
  await expectVerdict(page, 'redemption', { text: 'REDEMPTION · VERIFIED', result: 'good' })
  await page.getByRole('button', { name: 'Replay token' }).click()
  // Colour tracks integrity, not the return value: the origin refusing a second presentation is
  // the mechanism working, so the refusal is green in both the verdict and the live region. That
  // is exactly why the words alone cannot be the claim — REFUSED here is a pass.
  await expectVerdict(page, 'redemption', { text: 'REDEMPTION · REFUSED', result: 'good' })
  await expect(page.locator('#origin-ledger').getByText(/Replay refused/)).toBeVisible()
  await expectVerdict(page, 'status', { text: 'Replay refused', result: 'good' })
})

test('mode changes retire stale results while selecting the same mode is a no-op', async ({ page }) => {
  await page.getByRole('button', { name: '1. Issue token' }).click()
  await expectVerdict(page, 'dleq', { text: 'DLEQ PROOF · VERIFIED', result: 'good' })
  await page.getByLabel('Private issuance').check()
  await expectVerdict(page, 'dleq', { text: 'DLEQ PROOF · VERIFIED', result: 'good' })
  await page.getByLabel(/BROKEN: remove blinding/).check()
  await expect(page.locator('#issuer-ledger')).toContainText('Prior verdict retired')
  await expectVerdict(page, 'link-map', { text: 'Prior link result retired after mode change.', result: 'neutral' })
  await expect(page.getByRole('button', { name: '2. Redeem at origin' })).toBeDisabled()
})

test('[hidden] negative claim does not paint outside its fixture', async ({ page }) => {
  const claim = page.locator('#negative-claim')
  await expect(claim).toBeHidden()
  expect(await claim.evaluate((element) => getComputedStyle(element).display)).toBe('none')
})
