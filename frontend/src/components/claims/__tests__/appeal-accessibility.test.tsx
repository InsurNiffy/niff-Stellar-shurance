/**
 * @jest-environment jsdom
 *
 * Appeal UI accessibility — WCAG 2.1 AA automated gate (#1363).
 * Full conformance record: docs/appeal-accessibility-conformance.md
 */
import React from 'react'
import { render } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
import { AppealButton } from '../AppealButton'
import { AppealConfirmModal } from '../AppealConfirmModal'
import type { Claim } from '@/lib/schemas/vote'

expect.extend(toHaveNoViolations)

const AXE_OPTIONS = {
  rules: {
    // jsdom cannot compute contrast; Playwright covers color-contrast.
    'color-contrast': { enabled: false },
  },
}

const mockClaim: Claim = {
  claim_id: '123',
  policy_id: '456',
  claimant: 'GABC1234WXYZ5678GABC1234WXYZ5678GABC1234WXYZ5678GABC1234',
  amount: '1000000000',
  details: 'Test claim',
  evidence: [],
  status: 'Rejected',
  voting_deadline_ledger: 1000000,
  approve_votes: 5,
  reject_votes: 10,
  filed_at: 900000,
  total_voters: 20,
}

describe('Appeal UI accessibility (#1363)', () => {
  it('AppealButton (eligible) has no axe violations', async () => {
    const { container } = render(
      <AppealButton
        claim={mockClaim}
        walletAddress={mockClaim.claimant}
        onClick={jest.fn()}
      />,
    )
    const results = await axe(container, AXE_OPTIONS)
    expect(results).toHaveNoViolations()
  })

  it('AppealButton (ineligible note) has no axe violations', async () => {
    const { container } = render(
      <AppealButton
        claim={mockClaim}
        walletAddress={null}
        ineligibilityReason="NOT_CLAIMANT"
        onClick={jest.fn()}
      />,
    )
    const results = await axe(container, AXE_OPTIONS)
    expect(results).toHaveNoViolations()
  })

  it('AppealButton (loading) has no axe violations', async () => {
    const { container } = render(
      <AppealButton
        claim={mockClaim}
        walletAddress={mockClaim.claimant}
        loadingAppealStatus
        onClick={jest.fn()}
      />,
    )
    const results = await axe(container, AXE_OPTIONS)
    expect(results).toHaveNoViolations()
  })

  it('AppealConfirmModal (open) has no axe violations', async () => {
    const { container } = render(
      <AppealConfirmModal
        open
        claim={mockClaim}
        submitting={false}
        walletAddress={mockClaim.claimant}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    )
    const results = await axe(container, AXE_OPTIONS)
    expect(results).toHaveNoViolations()
  })
})
