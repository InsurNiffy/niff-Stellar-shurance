/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { GovernanceProposalDiscussion } from '../governance-proposal-discussion'
import {
  addProposalComment,
  clearProposalCommentsForTests,
  listProposalComments,
} from '@/lib/governance/proposal-comments'

describe('GovernanceProposalDiscussion', () => {
  beforeEach(() => {
    clearProposalCommentsForTests()
  })

  it('shows an existing comment thread for a proposal', async () => {
    addProposalComment('proposal-a', 'GABC…', 'First thoughts')

    render(<GovernanceProposalDiscussion proposalId="proposal-a" author="GABC…" />)

    await waitFor(() => {
      expect(screen.getByTestId('discussion-thread-proposal-a')).toBeInTheDocument()
    })
    expect(screen.getByText('First thoughts')).toBeInTheDocument()
  })

  it('posts a new comment', async () => {
    const user = userEvent.setup()
    render(<GovernanceProposalDiscussion proposalId="proposal-a" author="GVoter" />)

    await waitFor(() => {
      expect(screen.getByTestId('discussion-thread-proposal-a')).toBeInTheDocument()
    })

    await user.type(screen.getByPlaceholderText(/share your thoughts/i), 'Looks reasonable')
    await user.click(screen.getByRole('button', { name: /post comment/i }))

    await waitFor(() => {
      expect(screen.getByText('Looks reasonable')).toBeInTheDocument()
    })
    expect(listProposalComments('proposal-a')).toHaveLength(1)
  })

  it('scopes comments to the correct proposal', async () => {
    addProposalComment('proposal-a', 'Alice', 'Comment on A')
    addProposalComment('proposal-b', 'Bob', 'Comment on B')

    render(<GovernanceProposalDiscussion proposalId="proposal-a" author="Alice" />)

    await waitFor(() => {
      expect(screen.getByText('Comment on A')).toBeInTheDocument()
    })
    expect(screen.queryByText('Comment on B')).not.toBeInTheDocument()
  })

  it('does not leak comments between proposals when rendering two panels', async () => {
    addProposalComment('proposal-a', 'Alice', 'Only A')
    addProposalComment('proposal-b', 'Bob', 'Only B')

    render(
      <>
        <GovernanceProposalDiscussion proposalId="proposal-a" author="Alice" />
        <GovernanceProposalDiscussion proposalId="proposal-b" author="Bob" />
      </>,
    )

    await waitFor(() => {
      expect(screen.getByText('Only A')).toBeInTheDocument()
      expect(screen.getByText('Only B')).toBeInTheDocument()
    })

    const threadA = screen.getByTestId('discussion-thread-proposal-a')
    const threadB = screen.getByTestId('discussion-thread-proposal-b')
    expect(threadA).toHaveTextContent('Only A')
    expect(threadA).not.toHaveTextContent('Only B')
    expect(threadB).toHaveTextContent('Only B')
    expect(threadB).not.toHaveTextContent('Only A')
  })
})
