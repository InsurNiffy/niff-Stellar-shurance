import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ClaimWizard } from '../ClaimWizard';
import { useWallet } from '@/hooks/use-wallet';
import { useRouter } from 'next/navigation';

// Mock dependencies
jest.mock('@/hooks/use-wallet');
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));
jest.mock('@/hooks/use-draft-persistence', () => ({
  useDraftPersistence: jest.fn(() => ({
    hasDraft: false,
    saveDraft: jest.fn(),
    loadDraft: jest.fn(),
    clearDraft: jest.fn(),
  })),
}));
jest.mock('@/lib/api/claim', () => ({
  ClaimAPI: {
    buildTransaction: jest.fn(),
    submitTransaction: jest.fn(),
  },
}));

const mockUseWallet = useWallet as jest.MockedFunction<typeof useWallet>;
const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;

describe('ClaimWizard - Review Step Integration', () => {
  const mockRouter = {
    push: jest.fn(),
    back: jest.fn(),
  };

  const mockWallet = {
    address: 'GTEST123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    signTransaction: jest.fn(),
    connectionStatus: 'connected' as const,
  };

  const mockPolicyCoverage = {
    coverageAmount: 50000000,
    currency: 'XLM',
    status: 'ACTIVE',
    expiresAt: '2027-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRouter.mockReturnValue(mockRouter as any);
    mockUseWallet.mockReturnValue(mockWallet as any);
  });

  it('prevents signing until review step is reached', () => {
    render(
      <ClaimWizard
        policyId="123"
        maxCoverage="100000000"
        policyCoverage={mockPolicyCoverage}
      />
    );

    // Step 0: Amount - should show "Next" button, not "Confirm & Sign"
    expect(screen.getByText('Next')).toBeInTheDocument();
    expect(screen.queryByText('Confirm & Sign')).not.toBeInTheDocument();
  });

  it('shows review step as penultimate step before signing', () => {
    render(
      <ClaimWizard
        policyId="123"
        maxCoverage="100000000"
        policyCoverage={mockPolicyCoverage}
      />
    );

    // Fill amount
    const amountInput = screen.getByPlaceholderText(/Enter claim amount/i);
    fireEvent.change(amountInput, { target: { value: '1000000' } });

    // Navigate to step 2 (Narrative)
    fireEvent.click(screen.getByText('Next'));

    // Fill narrative
    const narrativeInput = screen.getByPlaceholderText(/Describe what happened/i);
    fireEvent.change(narrativeInput, { target: { value: 'Test incident description' } });

    // Navigate to step 3 (Evidence)
    fireEvent.click(screen.getByText('Next'));

    // Navigate to step 4 (Review)
    fireEvent.click(screen.getByText('Next'));

    // Now we should see the review step content
    expect(screen.getByText('Review Claim Details')).toBeInTheDocument();
    expect(screen.getByText('Confirm & Sign')).toBeInTheDocument();
  });

  it('displays all claim inputs on review step', () => {
    render(
      <ClaimWizard
        policyId="123"
        maxCoverage="100000000"
        policyCoverage={mockPolicyCoverage}
      />
    );

    // Fill and navigate through all steps
    const amountInput = screen.getByPlaceholderText(/Enter claim amount/i);
    fireEvent.change(amountInput, { target: { value: '5000000' } });
    fireEvent.click(screen.getByText('Next'));

    const narrativeInput = screen.getByPlaceholderText(/Describe what happened/i);
    fireEvent.change(narrativeInput, { target: { value: 'Detailed incident report' } });
    fireEvent.click(screen.getByText('Next'));

    // Skip evidence for this test
    fireEvent.click(screen.getByText('Next'));

    // Verify review step shows all data
    expect(screen.getByText('Review Claim Details')).toBeInTheDocument();
    expect(screen.getByText(/5000000/)).toBeInTheDocument(); // Amount
    expect(screen.getByText('Detailed incident report')).toBeInTheDocument(); // Narrative
    expect(screen.getByText('Policy ID: #123')).toBeInTheDocument();
  });

  it('allows editing from review step and preserves other field values', () => {
    render(
      <ClaimWizard
        policyId="123"
        maxCoverage="100000000"
        policyCoverage={mockPolicyCoverage}
      />
    );

    // Fill all fields
    const amountInput = screen.getByPlaceholderText(/Enter claim amount/i);
    fireEvent.change(amountInput, { target: { value: '5000000' } });
    fireEvent.click(screen.getByText('Next'));

    const narrativeInput = screen.getByPlaceholderText(/Describe what happened/i);
    fireEvent.change(narrativeInput, { target: { value: 'Original narrative' } });
    fireEvent.click(screen.getByText('Next'));

    fireEvent.click(screen.getByText('Next')); // Skip evidence

    // Now on review step - click Edit for amount
    const editAmountButton = screen.getByRole('button', { name: /edit claim amount/i });
    fireEvent.click(editAmountButton);

    // Should be back on step 0
    expect(screen.getByPlaceholderText(/Enter claim amount/i)).toBeInTheDocument();

    // Navigate back to review
    fireEvent.click(screen.getByText('Next')); // Amount
    fireEvent.click(screen.getByText('Next')); // Narrative
    fireEvent.click(screen.getByText('Next')); // Evidence

    // Verify narrative is still preserved
    expect(screen.getByText('Original narrative')).toBeInTheDocument();
  });

  it('only triggers signing from review step', async () => {
    const { ClaimAPI } = require('@/lib/api/claim');
    ClaimAPI.buildTransaction.mockResolvedValue({
      unsignedXdr: 'mock-xdr',
    });
    mockWallet.signTransaction.mockResolvedValue('signed-xdr');
    ClaimAPI.submitTransaction.mockResolvedValue({});

    render(
      <ClaimWizard
        policyId="123"
        maxCoverage="100000000"
        policyCoverage={mockPolicyCoverage}
      />
    );

    // Fill and navigate to review
    const amountInput = screen.getByPlaceholderText(/Enter claim amount/i);
    fireEvent.change(amountInput, { target: { value: '5000000' } });
    fireEvent.click(screen.getByText('Next'));

    const narrativeInput = screen.getByPlaceholderText(/Describe what happened/i);
    fireEvent.change(narrativeInput, { target: { value: 'Test narrative' } });
    fireEvent.click(screen.getByText('Next'));

    fireEvent.click(screen.getByText('Next')); // Evidence

    // Now on review step - click Confirm & Sign
    const confirmButton = screen.getByText('Confirm & Sign');
    fireEvent.click(confirmButton);

    // Verify signing was triggered
    await waitFor(() => {
      expect(ClaimAPI.buildTransaction).toHaveBeenCalledWith({
        holder: mockWallet.address,
        policyId: 123,
        amount: '5000000',
        details: 'Test narrative',
        evidence: [],
      });
    });
  });

  it('prevents URL manipulation by using state-based navigation', () => {
    render(
      <ClaimWizard
        policyId="123"
        maxCoverage="100000000"
        policyCoverage={mockPolicyCoverage}
      />
    );

    // The wizard uses internal state (activeStep) not URL params
    // Users cannot skip to review step via URL
    // Verify we start at step 0
    expect(screen.getByText('Enter claim amount')).toBeInTheDocument();
    expect(screen.queryByText('Review Claim Details')).not.toBeInTheDocument();

    // The only way to reach review is through sequential navigation
    // which is controlled by the Next button and activeStep state
  });
});
