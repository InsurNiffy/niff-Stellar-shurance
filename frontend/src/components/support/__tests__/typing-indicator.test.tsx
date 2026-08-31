/**
 * @jest-environment jsdom
 */
import { act, render, screen } from '@testing-library/react'
import React from 'react'

import { SupportTypingIndicator } from '../support-typing-indicator'
import { TicketThread } from '../ticket-thread'

describe('SupportTypingIndicator', () => {
  it('renders nothing when staff is not composing', () => {
    const { container } = render(<SupportTypingIndicator isTyping={false} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('support-typing-indicator')).not.toBeInTheDocument()
  })

  it('shows "support is typing" while active', () => {
    render(<SupportTypingIndicator isTyping />)
    expect(screen.getByTestId('support-typing-indicator')).toHaveTextContent(/support is typing/i)
  })
})

describe('TicketThread typing indicator', () => {
  const baseProps = {
    ticketId: 't-1',
    subject: 'Cannot renew policy',
    status: 'OPEN',
    messages: [
      {
        id: 'm1',
        author: 'customer' as const,
        body: 'I need help renewing.',
        createdAt: '2026-07-25T10:00:00.000Z',
      },
    ],
  }

  it('shows the indicator when staff is composing', () => {
    render(<TicketThread {...baseProps} isTypingOverride />)
    expect(screen.getByTestId('support-typing-indicator')).toBeInTheDocument()
  })

  it('clears the indicator when composing stops', () => {
    const { rerender } = render(<TicketThread {...baseProps} isTypingOverride />)
    expect(screen.getByTestId('support-typing-indicator')).toBeInTheDocument()

    act(() => {
      rerender(<TicketThread {...baseProps} isTypingOverride={false} />)
    })

    expect(screen.queryByTestId('support-typing-indicator')).not.toBeInTheDocument()
  })

  it('does not show an indicator when no staff is composing', () => {
    render(<TicketThread {...baseProps} isTypingOverride={false} />)
    expect(screen.queryByTestId('support-typing-indicator')).not.toBeInTheDocument()
  })
})
