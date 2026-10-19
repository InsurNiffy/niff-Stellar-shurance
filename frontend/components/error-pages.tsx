'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { logError } from '@/lib/log-shipper';

export type ErrorType = 'network' | 'auth' | 'contract' | 'unknown';

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset?: () => void;
  type?: ErrorType;
}

interface ErrorCopy {
  title: string;
  description: string;
}

const ERROR_COPY: Record<ErrorType, ErrorCopy> = {
  network: {
    title: 'Connection problem',
    description:
      'We could not reach the network. Check your internet connection and try again.',
  },
  auth: {
    title: 'Wallet not connected',
    description:
      'Your wallet session is missing or expired. Reconnect your wallet to continue.',
  },
  contract: {
    title: 'Contract call failed',
    description:
      'The smart contract rejected this request. Verify the details and try again.',
  },
  unknown: {
    title: 'Something went wrong',
    description:
      'An unexpected error occurred. You can try again or return to the previous page.',
  },
};

function inferErrorType(error: Error): ErrorType {
  const message = (error?.message ?? '').toLowerCase();
  if (message.includes('network') || message.includes('fetch')) {
    return 'network';
  }
  if (
    message.includes('wallet') ||
    message.includes('auth') ||
    message.includes('unauthorized')
  ) {
    return 'auth';
  }
  if (message.includes('contract') || message.includes('revert')) {
    return 'contract';
  }
  return 'unknown';
}

export default function ErrorPage({ error, reset, type }: ErrorPageProps) {
  const router = useRouter();
  const errorType: ErrorType = type ?? inferErrorType(error);
  const copy = ERROR_COPY[errorType];

  useEffect(() => {
    logError(error, { type: errorType, stack: error?.stack });
  }, [error, errorType]);

  const handleTryAgain = () => {
    if (reset) {
      reset();
    } else {
      router.refresh();
    }
  };

  const handleConnectWallet = () => {
    router.push('/wallet/connect');
  };

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">{copy.title}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{copy.description}</p>
      {error?.digest ? (
        <p className="text-xs text-muted-foreground">Reference: {error.digest}</p>
      ) : null}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {errorType === 'auth' ? (
          <button
            type="button"
            onClick={handleConnectWallet}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Connect wallet
          </button>
        ) : (
          <button
            type="button"
            onClick={handleTryAgain}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Try again
          </button>
        )}
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border px-4 py-2 text-sm font-medium"
        >
          Go back
        </button>
      </div>
    </div>
  );
}
