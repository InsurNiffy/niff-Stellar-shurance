import React from 'react';
import { render, waitFor, screen } from '@testing-library/react';
import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit';
import { WalletProvider, useWalletContext } from '../context/WalletContext';
import { WalletConnectButton } from '../components/WalletConnectButton';
import { toast } from '@/components/ui/use-toast';

jest.mock('@creit.tech/stellar-wallets-kit', () => ({
  StellarWalletsKit: {
    init: jest.fn(),
    on: jest.fn(),
    setWallet: jest.fn(),
    getAddress: jest.fn(),
    getNetwork: jest.fn(),
    setNetwork: jest.fn(),
    disconnect: jest.fn(),
    signTransaction: jest.fn(),
  },
  Networks: { PUBLIC: 'public', TESTNET: 'testnet', FUTURENET: 'futurenet' },
  KitEventType: { STATE_UPDATED: 'state_updated', DISCONNECT: 'disconnect' },
}));

jest.mock('@creit.tech/stellar-wallets-kit/modules/freighter', () => ({
  FreighterModule: jest.fn().mockImplementation(() => ({
    isAvailable: jest.fn().mockResolvedValue(true),
  })),
  FREIGHTER_ID: 'freighter',
}));

jest.mock('@creit.tech/stellar-wallets-kit/modules/xbull', () => ({
  xBullModule: jest.fn().mockImplementation(() => ({
    isAvailable: jest.fn().mockResolvedValue(true),
  })),
  XBULL_ID: 'xbull',
}));

jest.mock('@creit.tech/stellar-wallets-kit/modules/lobstr', () => ({
  LobstrModule: jest.fn().mockImplementation(() => ({
    isAvailable: jest.fn().mockResolvedValue(true),
  })),
  LOBSTR_ID: 'lobstr',
}));

jest.mock('@/components/ui/use-toast', () => ({
  toast: jest.fn(),
}));

jest.mock('../hooks/useWhitelistStatus', () => ({
  useWhitelistStatus: () => ({ data: null, isLoading: false }),
}));

const LS_WALLET_SESSION = 'niffyinsur-wallet-session-v1';

const TestComponent = () => {
  const { address, activeWalletId, connectionStatus } = useWalletContext();
  return (
    <div>
      <div data-testid="address">{address || 'none'}</div>
      <div data-testid="wallet-id">{activeWalletId || 'none'}</div>
      <div data-testid="status">{connectionStatus}</div>
    </div>
  );
};

describe('WalletContext Auto-Reconnect', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    (StellarWalletsKit.getNetwork as jest.Mock).mockResolvedValue({ network: 'testnet' });

    const { FreighterModule } = jest.requireMock('@creit.tech/stellar-wallets-kit/modules/freighter');
    FreighterModule.mockImplementation(() => ({
      isAvailable: jest.fn().mockResolvedValue(true),
    }));
  });

  it('silently reconnects when valid session exists', async () => {
    const session = { walletId: 'freighter', publicKey: 'GBXYZ...' };
    localStorage.setItem(LS_WALLET_SESSION, JSON.stringify(session));

    (StellarWalletsKit.getAddress as jest.Mock).mockResolvedValue({ address: 'GBXYZ...' });

    const { getByTestId } = render(
      <WalletProvider>
        <TestComponent />
      </WalletProvider>
    );

    await waitFor(() => {
      expect(getByTestId('status').textContent).toBe('connected');
      expect(getByTestId('address').textContent).toBe('GBXYZ...');
      expect(getByTestId('wallet-id').textContent).toBe('freighter');
    });

    expect(StellarWalletsKit.setWallet).toHaveBeenCalledWith('freighter');
    expect(toast).not.toHaveBeenCalled();
  });

  it('clears session when public keys mismatch', async () => {
    const session = { walletId: 'xbull', publicKey: 'GBXYZ...' };
    localStorage.setItem(LS_WALLET_SESSION, JSON.stringify(session));

    (StellarWalletsKit.getAddress as jest.Mock).mockResolvedValue({ address: 'GB123...' });

    const { getByTestId } = render(
      <WalletProvider>
        <TestComponent />
      </WalletProvider>
    );

    await waitFor(() => {
      expect(localStorage.getItem(LS_WALLET_SESSION)).toBeNull();
      expect(getByTestId('status').textContent).toBe('disconnected');
    });
  });

  it('falls back to manual connect UI when silent reconnect fails', async () => {
    const session = { walletId: 'freighter', publicKey: 'GBXYZ...' };
    localStorage.setItem(LS_WALLET_SESSION, JSON.stringify(session));

    (StellarWalletsKit.getAddress as jest.Mock).mockRejectedValue(new Error('Locked'));

    render(
      <WalletProvider>
        <WalletConnectButton />
      </WalletProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /connect wallet/i })).toBeInTheDocument();
    });

    expect(toast).not.toHaveBeenCalled();
  });

  it('does not connect without a persisted session', async () => {
    (StellarWalletsKit.getAddress as jest.Mock).mockResolvedValue({ address: 'GBXYZ...' });

    const { getByTestId } = render(
      <WalletProvider>
        <TestComponent />
      </WalletProvider>
    );

    await waitFor(() => {
      expect(getByTestId('status').textContent).toBe('disconnected');
    });

    expect(StellarWalletsKit.setWallet).not.toHaveBeenCalled();
  });

  it('skips silent reconnect when wallet extension is unavailable', async () => {
    const { FreighterModule } = jest.requireMock('@creit.tech/stellar-wallets-kit/modules/freighter');
    FreighterModule.mockImplementation(() => ({
      isAvailable: jest.fn().mockResolvedValue(false),
    }));

    const session = { walletId: 'freighter', publicKey: 'GBXYZ...' };
    localStorage.setItem(LS_WALLET_SESSION, JSON.stringify(session));

    const { getByTestId } = render(
      <WalletProvider>
        <TestComponent />
      </WalletProvider>
    );

    await waitFor(() => {
      expect(getByTestId('status').textContent).toBe('disconnected');
    });

    expect(StellarWalletsKit.setWallet).not.toHaveBeenCalled();
  });
});
