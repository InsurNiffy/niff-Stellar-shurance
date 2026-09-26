/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ClaimsListSkeleton, ClaimsDetailSkeleton } from '../components/ClaimsSkeleton';
import { ClaimsTable } from '../components/ClaimsTable';
import type { ClaimsTableProps } from '../components/ClaimsTable';
import type { ClaimBoard } from '@/lib/schemas/claims-board';

const makeClaim = (overrides: Partial<ClaimBoard> = {}): ClaimBoard => ({
  claim_id: 'CLM-001',
  policy_id: 'POL-001',
  claimant: 'GABC1234WXYZ5678GABC1234WXYZ5678GABC1234WXYZ5678GABC1234',
  amount: '1000000000',
  details: 'Test claim',
  evidence: [],
  status: 'Pending',
  voting_deadline_ledger: 1_000_000,
  approve_votes: 3,
  reject_votes: 1,
  filed_at: 1_700_000_000,
  total_voters: 10,
  ...overrides,
});

const defaultProps: ClaimsTableProps = {
  claims: [],
  isLoading: false,
  isFetching: false,
  error: null,
  total: 0,
  pageIndex: 0,
  hasNextPage: false,
  hasPrevPage: false,
  sort: 'filed_at',
  sortDir: 'desc',
  onSort: jest.fn(),
  onNextPage: jest.fn(),
  onPrevPage: jest.fn(),
  onRefetch: jest.fn(),
};

describe('ClaimsSkeleton', () => {
  it('ClaimsListSkeleton renders loading status', () => {
    render(<ClaimsListSkeleton />);
    expect(screen.getByTestId('claims-list-skeleton')).toBeInTheDocument();
    expect(screen.getByLabelText('Loading claims')).toHaveAttribute('aria-busy', 'true');
  });

  it('ClaimsDetailSkeleton renders loading status', () => {
    render(<ClaimsDetailSkeleton />);
    expect(screen.getByTestId('claims-detail-skeleton')).toBeInTheDocument();
    expect(screen.getByLabelText('Loading claim details')).toHaveAttribute('aria-busy', 'true');
  });
});

describe('ClaimsTable skeleton loading', () => {
  it('renders shared list skeleton while loading', () => {
    render(<ClaimsTable {...defaultProps} isLoading />);
    expect(screen.getByTestId('claims-list-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('No claims found')).not.toBeInTheDocument();
  });

  it('does not render claim data while loading', () => {
    render(<ClaimsTable {...defaultProps} isLoading claims={[makeClaim()]} />);
    expect(screen.queryByText('CLM-001')).not.toBeInTheDocument();
    expect(screen.getByTestId('claims-list-skeleton')).toBeInTheDocument();
  });

  it('replaces skeleton with real content once data arrives', () => {
    const { rerender } = render(<ClaimsTable {...defaultProps} isLoading />);
    expect(screen.getByTestId('claims-list-skeleton')).toBeInTheDocument();

    rerender(
      <ClaimsTable {...defaultProps} isLoading={false} claims={[makeClaim()]} total={1} />,
    );

    expect(screen.queryByTestId('claims-list-skeleton')).not.toBeInTheDocument();
    expect(screen.getByText('CLM-001')).toBeInTheDocument();
  });

  it('keeps error state distinct from skeleton', () => {
    render(<ClaimsTable {...defaultProps} error="Network error" />);
    expect(screen.queryByTestId('claims-list-skeleton')).not.toBeInTheDocument();
    expect(screen.getByText('Failed to load claims')).toBeInTheDocument();
  });

  it('keeps empty state distinct from skeleton', () => {
    render(<ClaimsTable {...defaultProps} />);
    expect(screen.queryByTestId('claims-list-skeleton')).not.toBeInTheDocument();
    expect(screen.getByText('No claims found')).toBeInTheDocument();
  });
});
