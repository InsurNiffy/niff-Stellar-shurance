/**
 * @jest-environment jsdom
 *
 * Tests for client-side search in the claims docs page (#1125).
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

import { ClaimsDocsClient } from '../ClaimsDocsClient'

const sections = [
  {
    id: 'filing-a-claim',
    heading: 'Filing a Claim',
    body: 'A policyholder calls file_claim on the contract.',
  },
  {
    id: 'timeline',
    heading: 'Timeline',
    body: 'T+0 Policyholder files claim on-chain. T+72h Default voting window closes.',
  },
  {
    id: 'claim-states',
    heading: 'Claim States',
    body: 'Open: Filed, voting in progress. Approved: Quorum met.',
  },
]

describe('ClaimsDocsClient — search (#1125)', () => {
  it('shows all sections when no query is entered', () => {
    render(<ClaimsDocsClient sections={sections} />)

    expect(screen.getByText('Filing a Claim')).toBeInTheDocument()
    expect(screen.getByText('Timeline')).toBeInTheDocument()
    expect(screen.getByText('Claim States')).toBeInTheDocument()
  })

  it('filters to matching sections when a query matches one section', () => {
    render(<ClaimsDocsClient sections={sections} />)

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Timeline' } })

    expect(screen.getByText('Timeline')).toBeInTheDocument()
    expect(screen.queryByText('Filing a Claim')).not.toBeInTheDocument()
    expect(screen.queryByText('Claim States')).not.toBeInTheDocument()
  })

  it('filters to multiple matching sections when the query matches several', () => {
    render(<ClaimsDocsClient sections={sections} />)

    // "claim" appears in "Filing a Claim", "Claim States", and body text
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'claim' } })

    expect(screen.getByText('Filing a Claim')).toBeInTheDocument()
    expect(screen.getByText('Claim States')).toBeInTheDocument()
  })

  it('shows a no-results state when the query matches nothing', () => {
    render(<ClaimsDocsClient sections={sections} />)

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'xyznotfound' } })

    expect(screen.getByRole('status')).toHaveTextContent(/no results/i)
    expect(screen.queryByText('Filing a Claim')).not.toBeInTheDocument()
  })

  it('restores the full documentation view when search is cleared', () => {
    render(<ClaimsDocsClient sections={sections} />)

    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: 'Timeline' } })
    expect(screen.queryByText('Filing a Claim')).not.toBeInTheDocument()

    fireEvent.change(input, { target: { value: '' } })
    expect(screen.getByText('Filing a Claim')).toBeInTheDocument()
    expect(screen.getByText('Timeline')).toBeInTheDocument()
    expect(screen.getByText('Claim States')).toBeInTheDocument()
  })

  it('no-results state has a clear button that resets the search', () => {
    render(<ClaimsDocsClient sections={sections} />)

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'xyznotfound' } })
    expect(screen.getByRole('status')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /clear the search/i }))

    // All sections should be visible again
    expect(screen.getByText('Filing a Claim')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
