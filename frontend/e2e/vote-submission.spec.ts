/**
 * e2e: Vote submission flow
 *
 * Covers the ClaimVotePanel on /claims/[claimId]:
 *   - Read-only tally visible to all visitors
 *   - Vote buttons shown only to eligible connected wallets
 *   - VoteConfirmModal appears before wallet signing
 *   - Voted state shown after successful submission
 *   - Ineligible wallet sees tally without vote buttons
 *
 * All backend and wallet calls are mocked — no real Stellar network access required.
 */

import { test, expect } from '@playwright/test'
import { injectWalletMock, injectNoWalletMock, MOCK_WALLET_ADDRESS } from './fixtures/wallet'
import { mockVoteApi } from './fixtures/api'

const CLAIM_ID = 'claim-vote-001'
const CLAIM_URL = `/claims/${CLAIM_ID}`

test.describe('Vote submission — eligible wallet', () => {
  test.beforeEach(async ({ page }) => {
    await injectWalletMock(page)
    await mockVoteApi(page, CLAIM_ID)
  })

  test('renders vote tally for all visitors', async ({ page }) => {
    await page.goto(CLAIM_URL)

    await expect(page.getByText(/current tally/i)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/approve/i)).toBeVisible()
    await expect(page.getByText(/reject/i)).toBeVisible()
  })

  test('shows Approve and Reject buttons for eligible connected wallet', async ({ page }) => {
    await page.goto(CLAIM_URL)

    await expect(page.getByRole('button', { name: /vote to approve/i })).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByRole('button', { name: /vote to reject/i })).toBeVisible()
  })

  test('clicking Approve opens confirmation modal', async ({ page }) => {
    await page.goto(CLAIM_URL)

    await expect(page.getByRole('button', { name: /vote to approve/i })).toBeVisible({
      timeout: 10_000,
    })
    await page.getByRole('button', { name: /vote to approve/i }).click()

    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText(/confirm approval vote/i)).toBeVisible()
  })

  test('confirmation modal shows current tally snapshot', async ({ page }) => {
    await page.goto(CLAIM_URL)

    await expect(page.getByRole('button', { name: /vote to approve/i })).toBeVisible({
      timeout: 10_000,
    })
    await page.getByRole('button', { name: /vote to approve/i }).click()

    await expect(page.getByRole('dialog')).toBeVisible()
    // Tally snapshot from mock: approve=3, reject=1
    await expect(page.getByText(/current tally/i)).toBeVisible()
    await expect(page.getByText(/approve.*3|3.*approve/i)).toBeVisible()
  })

  test('cancelling modal dismisses it without submitting', async ({ page }) => {
    await page.goto(CLAIM_URL)

    await expect(page.getByRole('button', { name: /vote to approve/i })).toBeVisible({
      timeout: 10_000,
    })
    await page.getByRole('button', { name: /vote to approve/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByRole('button', { name: /cancel/i }).click()

    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 3_000 })
    // Vote buttons still present — no vote was cast
    await expect(page.getByRole('button', { name: /vote to approve/i })).toBeVisible()
  })

  test('confirming vote submits and shows voted state', async ({ page }) => {
    await page.goto(CLAIM_URL)

    await expect(page.getByRole('button', { name: /vote to approve/i })).toBeVisible({
      timeout: 10_000,
    })
    await page.getByRole('button', { name: /vote to approve/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByRole('button', { name: /sign & approve/i }).click()

    // Voted state: "You voted Approve on this claim"
    await expect(page.getByText(/you voted/i)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/approve/i)).toBeVisible()
  })

  test('vote confirmed on-chain banner appears after submission', async ({ page }) => {
    await page.goto(CLAIM_URL)

    await expect(page.getByRole('button', { name: /vote to approve/i })).toBeVisible({
      timeout: 10_000,
    })
    await page.getByRole('button', { name: /vote to approve/i }).click()
    await page.getByRole('button', { name: /sign & approve/i }).click()

    await expect(page.getByText(/vote confirmed on-chain/i)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('link', { name: /view on explorer/i })).toBeVisible()
  })
})

test.describe('Vote submission — no wallet connected', () => {
  test.beforeEach(async ({ page }) => {
    await injectNoWalletMock(page)
    await mockVoteApi(page, CLAIM_ID)
  })

  test('tally is visible without wallet', async ({ page }) => {
    await page.goto(CLAIM_URL)

    await expect(page.getByText(/current tally/i)).toBeVisible({ timeout: 10_000 })
  })

  test('vote buttons are disabled without wallet', async ({ page }) => {
    await page.goto(CLAIM_URL)

    await expect(page.getByRole('button', { name: /vote to approve/i })).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByRole('button', { name: /vote to approve/i })).toBeDisabled()
    await expect(page.getByRole('button', { name: /vote to reject/i })).toBeDisabled()
  })

  test('ineligibility message is shown', async ({ page }) => {
    await page.goto(CLAIM_URL)

    await expect(page.getByText(/connect your wallet to vote/i)).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('Vote submission — already voted', () => {
  test.beforeEach(async ({ page }) => {
    await injectWalletMock(page)

    // Override eligibility to return priorVote
    const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
    await mockVoteApi(page, CLAIM_ID)
    await page.route(
      `${API_BASE}/api/claims/${CLAIM_ID}/eligibility*`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ eligible: true, reason: null, priorVote: 'Approve' }),
        })
      },
    )
  })

  test('shows prior vote badge and disables vote buttons', async ({ page }) => {
    await page.goto(CLAIM_URL)

    await expect(page.getByText(/you voted/i)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: /vote to approve/i })).toBeDisabled()
    await expect(page.getByRole('button', { name: /vote to reject/i })).toBeDisabled()
  })
})
