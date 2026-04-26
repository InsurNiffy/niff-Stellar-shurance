/**
 * API mock helpers — intercept backend and RPC calls so tests are
 * deterministic and do not require a running backend or testnet.
 */

import { Page, Route } from '@playwright/test'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// ---------------------------------------------------------------------------
// Quote API mocks
// ---------------------------------------------------------------------------

export async function mockQuoteApi(page: Page): Promise<void> {
  await page.route(`${API_BASE}/quotes`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        quoteId: 'mock-quote-001',
        premium: 12.5,
        coverageAmount: 1000,
        riskScore: 42,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        terms: [
          'Coverage is valid for 30 days from policy activation.',
          'Claims must be submitted within 7 days of the incident.',
          'Maximum payout is limited to the coverage amount.',
        ],
      }),
    })
  })

  await page.route(`${API_BASE}/quotes/mock-quote-001`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        quoteId: 'mock-quote-001',
        premium: 12.5,
        coverageAmount: 1000,
        riskScore: 42,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        terms: [
          'Coverage is valid for 30 days from policy activation.',
          'Claims must be submitted within 7 days of the incident.',
          'Maximum payout is limited to the coverage amount.',
        ],
      }),
    })
  })
}

// ---------------------------------------------------------------------------
// Policy API mocks
// ---------------------------------------------------------------------------

export async function mockPolicyApi(page: Page): Promise<void> {
  await page.route(`${API_BASE}/policies`, async (route: Route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        transactionXdr: 'mock-xdr-base64',
        policyId: 'mock-policy-001',
        estimatedFee: '0.01',
      }),
    })
  })

  await page.route(`${API_BASE}/policies/mock-policy-001/submit`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        policyId: 'mock-policy-001',
        transactionHash: 'abc123def456',
      }),
    })
  })

  await page.route(`${API_BASE}/policies/mock-policy-001`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        policyId: 'mock-policy-001',
        status: 'active',
        coverageAmount: 1000,
        premium: 12.5,
        expiresAt: new Date(Date.now() + 30 * 24 * 3_600_000).toISOString(),
        transactionHash: 'abc123def456',
      }),
    })
  })
}

// ---------------------------------------------------------------------------
// Policy initiation API mocks (build-transaction + submit)
// ---------------------------------------------------------------------------

export async function mockPolicyInitiateApi(page: Page): Promise<void> {
  await page.route(`${API_BASE}/api/policies/initiate`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        transactionXdr: 'mock-unsigned-xdr',
        estimatedFee: '0.01',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    })
  })

  await page.route(`${API_BASE}/api/policies/submit`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        policyId: 'mock-policy-001',
        transactionHash: 'abc123def456',
      }),
    })
  })

  await page.route(`${API_BASE}/api/policies/mock-policy-001`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        policyId: 'mock-policy-001',
        status: 'ACTIVE',
        coverageAmount: 1000,
        premium: 12.5,
        expiresAt: new Date(Date.now() + 30 * 24 * 3_600_000).toISOString(),
        transactionHash: 'abc123def456',
      }),
    })
  })
}

// ---------------------------------------------------------------------------
// Claim filing API mocks (build-transaction + submit)
// ---------------------------------------------------------------------------

export async function mockClaimFilingApi(page: Page): Promise<void> {
  await page.route(`${API_BASE}/api/policies/mock-policy-001`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        policyId: 'mock-policy-001',
        status: 'ACTIVE',
        coverageAmount: '10000000000',
        premium: '125000000',
        expiresAt: new Date(Date.now() + 30 * 24 * 3_600_000).toISOString(),
      }),
    })
  })

  await page.route(`${API_BASE}/api/claims/build-transaction`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        unsignedXdr: 'mock-claim-unsigned-xdr',
        minResourceFee: '100',
        baseFee: '100',
        totalEstimatedFee: '200',
        totalEstimatedFeeXlm: '0.00002',
        authRequirements: [],
      }),
    })
  })

  await page.route(`${API_BASE}/api/claims/submit`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        claimId: 42,
        transactionHash: 'claim-tx-hash-abc123',
      }),
    })
  })
}

// ---------------------------------------------------------------------------
// Vote API mocks (claim detail + eligibility + simulate + submit)
// ---------------------------------------------------------------------------

export async function mockVoteApi(page: Page, claimId = 'claim-vote-001'): Promise<void> {
  await page.route(`${API_BASE}/api/claims/${claimId}`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        claim_id: claimId,
        policy_id: 'policy-001',
        claimant: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
        amount: '500000000',
        details: 'Smart contract exploit caused fund loss.',
        evidence: [],
        status: 'Processing',
        voting_deadline_ledger: 9_999_999,
        approve_votes: 3,
        reject_votes: 1,
        filed_at: Date.now() - 86_400_000,
        total_voters: 10,
        quorum_bps: 5000,
      }),
    })
  })

  await page.route(
    `${API_BASE}/api/claims/${claimId}/eligibility*`,
    async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ eligible: true, reason: null, priorVote: null }),
      })
    },
  )

  await page.route(
    `${API_BASE}/api/claims/${claimId}/vote/simulate`,
    async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    },
  )

  await page.route(`${API_BASE}/api/claims/${claimId}/vote`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        transactionHash: 'vote-tx-hash-xyz789',
        status: 'Processing',
        approve_votes: 4,
        reject_votes: 1,
      }),
    })
  })
}

// ---------------------------------------------------------------------------
// Claims API mocks
// ---------------------------------------------------------------------------

export async function mockClaimsApi(page: Page): Promise<void> {
  await page.route(`${API_BASE}/claims*`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        claims: [
          {
            claim_id: 'claim-001',
            policy_id: 'policy-001',
            status: 'Pending',
            filed_at: new Date(Date.now() - 86_400_000).toISOString(),
            approve_votes: 3,
            reject_votes: 1,
            total_voters: 10,
            description: 'Smart contract exploit on DeFi protocol.',
          },
          {
            claim_id: 'claim-002',
            policy_id: 'policy-002',
            status: 'Approved',
            filed_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
            approve_votes: 7,
            reject_votes: 2,
            total_voters: 10,
            description: 'Bridge hack resulting in fund loss.',
          },
        ],
        total: 2,
        page: 1,
        totalPages: 1,
      }),
    })
  })
}
