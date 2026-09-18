import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => { await page.goto('/') })

test('private blind issuance redeems but gives the colluding ledgers no match', async ({ page }) => {
  await page.getByRole('button', { name: '1. Issue token' }).click()
  await expect(page.getByText('DLEQ PROOF · VERIFIED')).toBeVisible()
  const keyId = await page.locator('#key-id').textContent()
  expect(keyId).toHaveLength(64)
  await page.getByRole('button', { name: '2. Redeem at origin' }).click()
  await expect(page.getByText('REDEMPTION · VERIFIED')).toBeVisible()
  await page.getByRole('button', { name: '3. Try to link ledgers' }).click()
  await expect(page.getByText('COLLUSION CHECK · NO COMPUTABLE MATCH')).toBeVisible()
})

test('removing blinding produces an explicit link alarm', async ({ page }) => {
  await page.getByLabel(/BROKEN: remove blinding/).check()
  await expect(page.getByText('Prior result retired')).toBeVisible()
  await page.getByRole('button', { name: '1. Issue token' }).click()
  await page.getByRole('button', { name: '3. Try to link ledgers' }).click()
  await expect(page.getByText('COLLUSION CHECK · LINKED: BLINDING WAS REMOVED')).toBeVisible()
})

test('a key-partition response is rejected before a token exists', async ({ page }) => {
  await page.getByLabel(/BROKEN: per-client published key/).check()
  await page.getByRole('button', { name: '1. Issue token' }).click()
  await expect(page.getByText('DLEQ PROOF · REJECTED AS DESIGNED')).toBeVisible()
  await expect(page.getByText(/no token/i)).toBeVisible()
})

test('a redeemed token cannot be replayed', async ({ page }) => {
  await page.getByRole('button', { name: '1. Issue token' }).click()
  await page.getByRole('button', { name: '2. Redeem at origin' }).click()
  await page.getByRole('button', { name: 'Replay token' }).click()
  await expect(page.getByText('REDEMPTION · REFUSED')).toBeVisible()
  await expect(page.locator('#origin-ledger').getByText(/Replay refused/)).toBeVisible()
})