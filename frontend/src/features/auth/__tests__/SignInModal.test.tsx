/**
 * Sign-in explainer modal UI (#1507): explainer copy, loading + error states.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SignInDialogView } from '@/features/auth/components/SignInModal';

function renderView(props: Partial<React.ComponentProps<typeof SignInDialogView>> = {}) {
  const onOpenChange = jest.fn();
  const onSignIn = jest.fn();
  render(
    <SignInDialogView
      open
      onOpenChange={onOpenChange}
      status="unauthenticated"
      error={null}
      onSignIn={onSignIn}
      {...props}
    />,
  );
  return { onOpenChange, onSignIn };
}

describe('SignInDialogView (#1507)', () => {
  it('shows the cost-free signing explainer', () => {
    renderView();
    expect(
      screen.getByText(/Signing proves you own this wallet; it costs nothing/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/no transaction is created/i)).toBeInTheDocument();
  });

  it('invokes signIn when confirmed', async () => {
    const { onSignIn } = renderView();
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('shows a loading state while waiting for the signature', () => {
    renderView({ status: 'loading' });
    expect(screen.getByText(/waiting for signature/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /waiting for signature/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
  });

  it('renders the rejection error state', () => {
    renderView({ error: 'You rejected the signature request.' });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('You rejected the signature request.');
  });
});
