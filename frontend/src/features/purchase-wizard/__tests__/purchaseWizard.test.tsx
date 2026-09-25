import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PurchaseWizard } from '../PurchaseWizard';
import type { PurchaseWizardProps } from '../types';

const baseQuote = {
  id: 'quote-1',
  asset: 'USDC',
  premium: '120.00',
  coverage: '10000.00',
  termsHash: 'abc123hash',
  termsDocument: 'These are the policy terms.',
};

function renderWizard(overrides: Partial<PurchaseWizardProps> = {}) {
  const props: PurchaseWizardProps = {
    quote: baseQuote,
    wallet: { connected: true, signedIn: true, address: 'GABC', balance: '1000.00', trustline: true },
    onSignAndPay: vi.fn().mockResolvedValue({ policyId: 'policy-42' }),
    onOpenFiatRamp: vi.fn(),
    ...overrides,
  };
  return { ...render(<PurchaseWizard {...props} />), props };
}

beforeEach(() => {
  sessionStorage.clear();
});

describe('PurchaseWizard', () => {
  it('validates each step before allowing next', async () => {
    renderWizard();
    // Step 1: confirm quote
    expect(screen.getByText(/confirm quote/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    // Step 2: options
    expect(screen.getByText(/options/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    // Step 3: review terms — cannot proceed without accepting
    expect(screen.getByText(/review terms/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/accept/i));
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();
  });

  it('keeps entered data when navigating back', async () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.change(screen.getByLabelText(/beneficiary/i), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/deductible/i), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByLabelText(/beneficiary/i)).toHaveValue('Jane Doe');
    expect(screen.getByLabelText(/deductible/i)).toHaveValue('500');
  });

  it('shows insufficient balance path with fiat ramp link', async () => {
    const onOpenFiatRamp = vi.fn();
    renderWizard({
      wallet: { connected: true, signedIn: true, address: 'GABC', balance: '1.00', trustline: true },
      onOpenFiatRamp,
    });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByLabelText(/accept/i));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByText(/insufficient balance/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /fiat ramp/i }));
    expect(onOpenFiatRamp).toHaveBeenCalled();
  });

  it('completes the success path with a mocked transaction', async () => {
    const onSignAndPay = vi.fn().mockResolvedValue({ policyId: 'policy-42' });
    renderWizard({ onSignAndPay });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByLabelText(/accept/i));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /sign and pay/i }));
    await waitFor(() => expect(onSignAndPay).toHaveBeenCalled());
    expect(await screen.findByText(/policy-42/)).toBeInTheDocument();
  });
});
