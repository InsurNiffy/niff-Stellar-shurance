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
})
