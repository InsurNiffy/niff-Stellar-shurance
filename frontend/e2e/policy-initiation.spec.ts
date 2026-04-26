/**
 * e2e: Policy initiation flow
 *
 * Covers the full 4-step policy creation wizard:
 *   0. Verify Quote → 1. Connect Wallet → 2. Sign Transaction → 3. Confirmation
 *
 * All backend and wallet calls are mocked — no real Stellar network access required.
 */

import { test, expect } from '@playwright/test'
import { injectWalletMock, MOCK_WALLET_ADDRESS } from './fixtures/wallet'
import { mockQuoteApi, mockPolicyInitiateApi } from './fixtures/api'

test.describe('Policy initiation flow', () => {
  test.beforeEach(async ({ page }) => {
    await injectWalletMock(page)
    await mockQuoteApi(page)
    await mockPolicyInitiateApi(page)
  })

  test('renders quote verification step on load', async ({ page }) => {
    await page.goto('/policy?quoteId=mock-quote-001')

    await expect(
      page.getByRole('heading', { name: /create insurance policy/i }),
    ).toBeVisible({ timeout: 10_000 })

    await expect(page.getByText(/verify quote/i)).toBeVisible()
  })

  test('displays quote details after loading', async ({ page }) => {
    await page.goto('/policy?quoteId=mock-quote-001')

    // Premium and coverage from mock fixture
    await expect(page.getByText(/12\.5|premium/i)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/coverage amount/i)).toBeVisible()
  })

  test('advances to wallet connection step', async ({ page }) => {
    await page.goto('/policy?quoteId=mock-quote-001')

    // Wait for quote to load then continue
    await expect(page.getByRole('button', { name: /continue to wallet/i })).toBeVisible({
      timeout: 10_000,
    })
    await page.getByRole('button', { name: /continue to wallet/i }).click()

    await expect(page.getByRole('button', { name: /connect wallet/i })).toBeVisible()
  })

  test('connects wallet and advances to sign transaction step', async ({ page }) => {
    await page.goto('/policy?quoteId=mock-quote-001')

    await expect(page.getByRole('button', { name: /continue to wallet/i })).toBeVisible({
      timeout: 10_000,
    })
    await page.getByRole('button', { name: /continue to wallet/i }).click()
    await page.getByRole('button', { name: /connect wallet/i }).click()

    // Wallet connected — address should appear
    await expect(page.getByText(MOCK_WALLET_ADDRESS.slice(0, 8))).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/sign transaction/i)).toBeVisible()
  })

  test('submits policy and shows confirmation with policy ID', async ({ page }) => {
    await page.goto('/policy?quoteId=mock-quote-001')

    // Step 0 → 1
    await expect(page.getByRole('button', { name: /continue to wallet/i })).toBeVisible({
      timeout: 10_000,
    })
    await page.getByRole('button', { name: /continue to wallet/i }).click()

    // Step 1 → 2
    await page.getByRole('button', { name: /connect wallet/i }).click()
    await expect(page.getByText(/sign transaction/i)).toBeVisible({ timeout: 10_000 })

    // Step 2: accept terms and submit
    await page.getByLabel(/accept the terms/i).check()
    await page.getByRole('button', { name: /initiate policy/i }).click()

    // Step 3: confirmation
    await expect(page.getByText(/policy created successfully/i)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/mock-policy-001/i)).toBeVisible()
  })

  test('wallet address is not exposed in page source before connection', async ({ page }) => {
    await page.goto('/policy?quoteId=mock-quote-001')

    const content = await page.textContent('body')
    expect(content).not.toContain('undefined')
    // Full address must not appear before wallet is connected
    expect(content).not.toContain(MOCK_WALLET_ADDRESS)
  })
})
