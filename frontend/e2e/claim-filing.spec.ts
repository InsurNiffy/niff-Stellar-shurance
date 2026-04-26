/**
 * e2e: Claim filing wizard
 *
 * Covers all 4 wizard steps:
 *   0. Amount → 1. Narrative → 2. Evidence → 3. Review → submission
 *
 * All backend and wallet calls are mocked — no real Stellar network access required.
 */

import { test, expect } from '@playwright/test'
import { injectWalletMock } from './fixtures/wallet'
import { mockClaimFilingApi } from './fixtures/api'

const POLICY_ID = 'mock-policy-001'

test.describe('Claim filing wizard', () => {
  test.beforeEach(async ({ page }) => {
    await injectWalletMock(page)
    await mockClaimFilingApi(page)
  })

  test('renders the claim wizard with Amount step active', async ({ page }) => {
    await page.goto(`/policy/${POLICY_ID}/claim`)

    await expect(page.getByRole('heading', { name: /file insurance claim/i })).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByText(/amount/i)).toBeVisible()
  })

  test('Next button is disabled until amount is entered', async ({ page }) => {
    await page.goto(`/policy/${POLICY_ID}/claim`)

    await expect(page.getByRole('button', { name: /next/i })).toBeDisabled({ timeout: 10_000 })

    await page.getByRole('spinbutton').fill('500')
    await expect(page.getByRole('button', { name: /next/i })).toBeEnabled()
  })

  test('advances through Amount → Narrative steps', async ({ page }) => {
    await page.goto(`/policy/${POLICY_ID}/claim`)

    await expect(page.getByRole('button', { name: /next/i })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('spinbutton').fill('500')
    await page.getByRole('button', { name: /next/i }).click()

    await expect(page.getByText(/narrative|describe/i)).toBeVisible({ timeout: 5_000 })
  })

  test('advances through all steps to Review', async ({ page }) => {
    await page.goto(`/policy/${POLICY_ID}/claim`)

    // Step 0 — Amount
    await expect(page.getByRole('button', { name: /next/i })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('spinbutton').fill('500')
    await page.getByRole('button', { name: /next/i }).click()

    // Step 1 — Narrative
    await expect(page.getByRole('textbox')).toBeVisible({ timeout: 5_000 })
    await page.getByRole('textbox').fill('Smart contract exploit caused fund loss on the DeFi protocol.')
    await page.getByRole('button', { name: /next/i }).click()

    // Step 2 — Evidence (optional, skip)
    await expect(page.getByText(/evidence|upload/i)).toBeVisible({ timeout: 5_000 })
    await page.getByRole('button', { name: /next/i }).click()

    // Step 3 — Review
    await expect(page.getByText(/review claim details/i)).toBeVisible({ timeout: 5_000 })
  })

  test('Review step shows entered amount and narrative', async ({ page }) => {
    await page.goto(`/policy/${POLICY_ID}/claim`)

    await expect(page.getByRole('button', { name: /next/i })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('spinbutton').fill('500')
    await page.getByRole('button', { name: /next/i }).click()

    await page.getByRole('textbox').fill('DeFi exploit narrative text')
    await page.getByRole('button', { name: /next/i }).click()

    // Skip evidence
    await page.getByRole('button', { name: /next/i }).click()

    // Review step — verify data is shown
    await expect(page.getByText(/review claim details/i)).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText(/DeFi exploit narrative text/i)).toBeVisible()
    await expect(page.getByText(new RegExp(POLICY_ID))).toBeVisible()
  })

  test('Edit buttons on Review step navigate back to correct step', async ({ page }) => {
    await page.goto(`/policy/${POLICY_ID}/claim`)

    await expect(page.getByRole('button', { name: /next/i })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('spinbutton').fill('500')
    await page.getByRole('button', { name: /next/i }).click()
    await page.getByRole('textbox').fill('Some narrative')
    await page.getByRole('button', { name: /next/i }).click()
    await page.getByRole('button', { name: /next/i }).click()

    // On Review step — click Edit on Narrative card
    const editButtons = page.getByRole('button', { name: /edit/i })
    await editButtons.nth(1).click()

    // Should be back on Narrative step
    await expect(page.getByRole('textbox')).toBeVisible({ timeout: 5_000 })
  })

  test('submits claim and shows success screen', async ({ page }) => {
    await page.goto(`/policy/${POLICY_ID}/claim`)

    await expect(page.getByRole('button', { name: /next/i })).toBeVisible({ timeout: 10_000 })
    await page.getByRole('spinbutton').fill('500')
    await page.getByRole('button', { name: /next/i }).click()

    await page.getByRole('textbox').fill('Smart contract exploit caused fund loss.')
    await page.getByRole('button', { name: /next/i }).click()

    // Skip evidence
    await page.getByRole('button', { name: /next/i }).click()

    // Sign & Submit
    await page.getByRole('button', { name: /sign & submit/i }).click()

    await expect(page.getByText(/claim filed successfully/i)).toBeVisible({ timeout: 15_000 })
  })
})
