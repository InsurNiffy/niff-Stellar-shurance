/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

import { VoteConfirmModal } from '../vote-confirm-modal'

// Radix Dialog uses portals; keep it simple by rendering into document.body
beforeAll(() => {
  // Radix needs a pointer-events check
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  })
})

const defaultProps = {
  open: true,
  vote: 'Approve' as const,
  claimId: 'claim-abc-123',
  submitting: false,
  onConfirm: jest.fn(),
  onCancel: jest.fn(),
}

describe('VoteConfirmModal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders with correct vote option (Approve)', () => {
    render(<VoteConfirmModal {...defaultProps} />)
    expect(screen.getByText(/confirm approval vote/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign & approve/i })).toBeInTheDocument()
  })

  it('renders with correct vote option (Reject)', () => {
    render(<VoteConfirmModal {...defaultProps} vote="Reject" />)
    expect(screen.getByText(/confirm rejection vote/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign & reject/i })).toBeInTheDocument()
  })

  it('renders current tally when claim prop is provided', () => {
    render(
      <VoteConfirmModal
        {...defaultProps}
        claim={{ approve_votes: 5, reject_votes: 3, total_voters: 20 }}
      />,
    )
    expect(screen.getByText(/current tally/i)).toBeInTheDocument()
    expect(screen.getByText(/approve: 5/i)).toBeInTheDocument()
    expect(screen.getByText(/reject: 3/i)).toBeInTheDocument()
    expect(screen.getByText(/8 of 20 voted/i)).toBeInTheDocument()
  })

  it('shows irreversibility warning', () => {
    render(<VoteConfirmModal {...defaultProps} />)
    expect(screen.getByText(/this action is irreversible/i)).toBeInTheDocument()
  })

  it('shows governance explainer copy', () => {
    render(<VoteConfirmModal {...defaultProps} />)
    expect(
      screen.getByText(/no single vote determines the result/i),
    ).toBeInTheDocument()
  })

  it('calls onCancel when Cancel button is clicked', () => {
    render(<VoteConfirmModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1)
  })

  it('calls onConfirm when confirm button is clicked', () => {
    render(<VoteConfirmModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /sign & approve/i }))
    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1)
  })

  it('disables buttons and shows signing state while submitting', () => {
    render(<VoteConfirmModal {...defaultProps} submitting={true} />)
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled()
    expect(screen.getByText(/signing…/i)).toBeInTheDocument()
  })

  it('returns null when vote is null', () => {
    const { container } = render(<VoteConfirmModal {...defaultProps} vote={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('has aria-modal attribute on dialog content', () => {
    render(<VoteConfirmModal {...defaultProps} />)
    // The dialog content should have aria-modal
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('calls onCancel when ESC key is pressed', () => {
    render(<VoteConfirmModal {...defaultProps} />)
    const dialog = screen.getByRole('dialog')
    
    // Simulate ESC key press
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape', keyCode: 27 })
    
    // Radix Dialog handles ESC internally and calls onOpenChange(false)
    // which triggers onCancel in our implementation
    expect(defaultProps.onCancel).toHaveBeenCalled()
  })

  it('does not dismiss when submitting (prevents accidental cancellation)', () => {
    render(<VoteConfirmModal {...defaultProps} submitting={true} />)
    
    // Cancel button should be disabled during submission
    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    expect(cancelButton).toBeDisabled()
  })

  it('displays vote option prominently in title', () => {
    render(<VoteConfirmModal {...defaultProps} vote="Approve" />)
    const title = screen.getByRole('heading', { name: /confirm approval vote/i })
    expect(title).toBeInTheDocument()
    
    // Prominent vote display should be present
    expect(screen.getByText(/you are voting to/i)).toBeInTheDocument()
    expect(screen.getByText(/APPROVE/i)).toBeInTheDocument()
    
    // Icon should be present for visual prominence
    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelector('svg')).toBeInTheDocument()
  })

  it('explains what approve means for the claimant', () => {
    render(<VoteConfirmModal {...defaultProps} vote="Approve" />)
    expect(
      screen.getByText(/if a quorum of eligible policyholders approves, the claimant becomes eligible for payout/i)
    ).toBeInTheDocument()
  })

  it('explains what reject means for the claimant', () => {
    render(<VoteConfirmModal {...defaultProps} vote="Reject" />)
    expect(
      screen.getByText(/if a quorum of eligible policyholders rejects, no payout will be issued/i)
    ).toBeInTheDocument()
  })
})
