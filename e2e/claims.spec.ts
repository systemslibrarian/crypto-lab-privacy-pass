import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => { await page.goto('/') })

test('private blind issuance redeems but gives the colluding ledgers no match', async ({ page }) => {
  await page.getByRole('button', { name: '1. Issue token' }).click()
  await expect(page.getByText('DLEQ PROOF · VERIFIED')).toBeVisible()
  await page.getByText('Inspect the real wire values and scope').click()
  const keyId = await page.locator('#key-id').textContent()
  const request = await page.locator('#wire-request').textContent()
  const response = await page.locator('#wire-response').textContent()
  const token = await page.locator('#wire-token').textContent()
  const katText = await page.locator('#kat-count').textContent()
  expect(keyId).toHaveLength(64)
  expect(request).toHaveLength(104)
  expect(response).toHaveLength(290)
  expect(token).toHaveLength(292)
  const katCounts = katText?.match(/^(\d+) vectors: (\d+).* \+ (\d+)/)
  expect(Number(katCounts?.[1])).toBe(Number(katCounts?.[2]) + Number(katCounts?.[3]))
  await page.getByRole('button', { name: '2. Redeem at origin' }).click()
  await expect(page.getByText('REDEMPTION · VERIFIED')).toBeVisible()
  await page.getByRole('button', { name: '3. Try to link ledgers' }).click()
  await expect(page.getByText('COLLUSION CHECK · NO COMPUTABLE MATCH')).toBeVisible()
  await expect(page.locator('#link-map .computed-link')).toHaveCount(0)
})

test('removing blinding produces an explicit link alarm', async ({ page }) => {
  await page.getByLabel(/BROKEN: remove blinding/).check()
  await expect(page.getByText('Prior result retired')).toBeVisible()
  await page.getByRole('button', { name: '1. Issue token' }).click()
  const issuerPoint = (await page.locator('#issuer-ledger code').textContent())?.replace(/^blinded element: /, '')
  await page.getByRole('button', { name: '3. Try to link ledgers' }).click()
  await expect(page.getByText('COLLUSION CHECK · LINKED: BLINDING WAS REMOVED')).toBeVisible()
  await expect(page.locator('#link-map .computed-link')).toHaveCount(1)
  expect(issuerPoint).not.toBe('')
})

test('valid proofs under client-specific keys redeem and reveal partitioning', async ({ page }) => {
  await page.getByLabel(/BROKEN: per-client published key/).check()
  await page.getByRole('button', { name: '1. Issue token' }).click()
  await expect(page.getByText('DLEQ PROOFS · BOTH VERIFIED')).toBeVisible()
  await page.getByRole('button', { name: '2. Redeem at origin' }).click()
  await expect(page.getByText('REDEMPTIONS · BOTH VERIFIED')).toBeVisible()
  await page.getByRole('button', { name: '3. Try to link ledgers' }).click()
  await expect(page.getByText('PROOFS VERIFIED · AND PARTITIONED')).toBeVisible()
  await expect(page.locator('#link-map .computed-link')).toHaveCount(2)
  await expect(page.locator('#negative-claim')).toBeVisible()
  await expect(page.locator('#negative-claim')).toContainText('does not show it published the same key to every client')
})

test('a redeemed token cannot be replayed', async ({ page }) => {
  await page.getByRole('button', { name: '1. Issue token' }).click()
  await page.getByRole('button', { name: '2. Redeem at origin' }).click()
  await page.getByRole('button', { name: 'Replay token' }).click()
  await expect(page.getByText('REDEMPTION · REFUSED')).toBeVisible()
  await expect(page.locator('#origin-ledger').getByText(/Replay refused/)).toBeVisible()
})

test('mode changes retire stale results while selecting the same mode is a no-op', async ({ page }) => {
  await page.getByRole('button', { name: '1. Issue token' }).click()
  await expect(page.getByText('DLEQ PROOF · VERIFIED')).toBeVisible()
  await page.getByLabel('Private issuance').check()
  await expect(page.getByText('DLEQ PROOF · VERIFIED')).toBeVisible()
  await page.getByLabel(/BROKEN: remove blinding/).check()
  await expect(page.locator('#issuer-ledger')).toContainText('Prior verdict retired')
  await expect(page.getByRole('button', { name: '2. Redeem at origin' })).toBeDisabled()
})

test('[hidden] negative claim does not paint outside its fixture', async ({ page }) => {
  const claim = page.locator('#negative-claim')
  await expect(claim).toBeHidden()
  expect(await claim.evaluate((element) => getComputedStyle(element).display)).toBe('none')
})