/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('ClaimsTable', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('loading state', () => {
    it('renders skeleton rows when isLoading is true', () => {
      render(<ClaimsTable {...defaultProps} isLoading />);
      expect(screen.getByTestId('claims-list-skeleton')).toBeInTheDocument();
      expect(screen.queryByText('CLM-001')).not.toBeInTheDocument();
    });

    it('does not render claim data while loading', () => {
      const claims = [makeClaim()];
      render(<ClaimsTable {...defaultProps} isLoading claims={claims} />);
      expect(screen.queryByText('CLM-001')).not.toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows error message and retry button', () => {
      render(<ClaimsTable {...defaultProps} error="Network error" />);
      expect(screen.getByText('Failed to load claims')).toBeInTheDocument();
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });

    it('calls onRefetch when retry is clicked', async () => {
      const onRefetch = jest.fn();
      const user = userEvent.setup();
      render(<ClaimsTable {...defaultProps} error="Network error" onRefetch={onRefetch} />);
      await user.click(screen.getByText('Try again'));
      expect(onRefetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('empty state', () => {
    it('shows empty state when no claims and not loading', () => {
      render(<ClaimsTable {...defaultProps} />);
      expect(screen.getByText('No claims found')).toBeInTheDocument();
    });
  });

  describe('data rendering', () => {
    it('renders claim rows', () => {
      const claims = [makeClaim(), makeClaim({ claim_id: 'CLM-002', policy_id: 'POL-002' })];
      render(<ClaimsTable {...defaultProps} claims={claims} total={2} />);
      expect(screen.getByText('CLM-001')).toBeInTheDocument();
      expect(screen.getByText('CLM-002')).toBeInTheDocument();
    });

    it('renders status badge with shape and label', () => {
      const claims = [makeClaim({ status: 'Approved' })];
      render(<ClaimsTable {...defaultProps} claims={claims} total={1} />);
      expect(screen.getByLabelText('Status: Approved')).toBeInTheDocument();
    });

    it('shows total count', () => {
      const claims = [makeClaim()];
      render(<ClaimsTable {...defaultProps} claims={claims} total={42} />);
      expect(screen.getByText('42 claims')).toBeInTheDocument();
    });

    it('shows singular "claim" for total of 1', () => {
      const claims = [makeClaim()];
      render(<ClaimsTable {...defaultProps} claims={claims} total={1} />);
      expect(screen.getByText('1 claim')).toBeInTheDocument();
    });

    it('renders deadline_timestamp when provided', () => {
      const claims = [makeClaim({ deadline_timestamp: '2024-01-15T00:00:00Z' })];
      render(<ClaimsTable {...defaultProps} claims={claims} total={1} />);
      // Should show a date string, not ledger number
      expect(screen.queryByText(/Ledger/)).not.toBeInTheDocument();
    });

    it('falls back to ledger number when no deadline_timestamp', () => {
      const claims = [makeClaim({ voting_deadline_ledger: 999_999 })];
      render(<ClaimsTable {...defaultProps} claims={claims} total={1} />);
      expect(screen.getByText('Ledger 999999')).toBeInTheDocument();
    });
  });

  describe('sorting', () => {
    it('calls onSort with correct field when sort button clicked', async () => {
      const onSort = jest.fn();
      const user = userEvent.setup();
      render(<ClaimsTable {...defaultProps} onSort={onSort} />);
      await user.click(screen.getByRole('button', { name: /sort by filed/i }));
      expect(onSort).toHaveBeenCalledWith('filed_at');
    });

    it('shows sort direction indicator for active sort column', () => {
      render(<ClaimsTable {...defaultProps} sort="filed_at" sortDir="asc" />);
      expect(screen.getByRole('button', { name: /currently asc/i })).toBeInTheDocument();
    });

    it('shows descending indicator when sortDir is desc', () => {
      render(<ClaimsTable {...defaultProps} sort="deadline" sortDir="desc" />);
      expect(screen.getByRole('button', { name: /currently desc/i })).toBeInTheDocument();
    });
  });

  describe('pagination', () => {
    it('hides pagination when no claims and no prev page', () => {
      render(<ClaimsTable {...defaultProps} total={0} hasPrevPage={false} />);
      expect(screen.queryByRole('navigation', { name: /pagination/i })).not.toBeInTheDocument();
    });

    it('shows pagination when there are claims', () => {
      const claims = [makeClaim()];
      render(<ClaimsTable {...defaultProps} claims={claims} total={1} />);
      expect(screen.getByRole('navigation', { name: /pagination/i })).toBeInTheDocument();
    });

    it('calls onNextPage when next button clicked', async () => {
      const onNextPage = jest.fn();
      const user = userEvent.setup();
      const claims = [makeClaim()];
      render(
        <ClaimsTable
          {...defaultProps}
          claims={claims}
          total={20}
          hasNextPage
          onNextPage={onNextPage}
        />,
      );
      await user.click(screen.getByRole('button', { name: /next page/i }));
      expect(onNextPage).toHaveBeenCalledTimes(1);
    });

    it('calls onPrevPage when prev button clicked', async () => {
      const onPrevPage = jest.fn();
      const user = userEvent.setup();
      const claims = [makeClaim()];
      render(
        <ClaimsTable
          {...defaultProps}
          claims={claims}
          total={20}
          pageIndex={1}
          hasPrevPage
          onPrevPage={onPrevPage}
        />,
      );
      await user.click(screen.getByRole('button', { name: /previous page/i }));
      expect(onPrevPage).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetching state', () => {
    it('applies reduced opacity while fetching (not initial load)', () => {
      const claims = [makeClaim()];
      const { container } = render(
        <ClaimsTable {...defaultProps} claims={claims} total={1} isFetching />,
      );
      expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    });
  });
});
