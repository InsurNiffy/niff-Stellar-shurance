'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { logError } from '@/lib/log-shipper';

export type ErrorType = 'network' | 'auth' | 'contract' | 'unknown';

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
      'The smart contract rejected this request. Please review the details and try again.',
  },
  unknown: {
    title: 'Something went wrong',
    description:
      'An unexpected error occurred. You can try again or return to the previous page.',
  },
};

function classifyError(error: Error): ErrorType {
  const message = (error?.message || '').toLowerCase();
  if (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('timeout') ||
    message.includes('offline')
  ) {
    return 'network';
  }
  if (
    message.includes('wallet') ||
    message.includes('unauthorized') ||
    message.includes('auth') ||
    message.includes('connect')
  ) {
    return 'auth';
  }
  if (
    message.includes('contract') ||
    message.includes('revert') ||
    message.includes('transaction')
  ) {
    return 'contract';
  }
  return 'unknown';
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (props: {
    error: Error;
    reset: () => void;
    errorType: ErrorType;
  }) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logError(error, { componentStack: errorInfo.componentStack });
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    const { hasError, error } = this.state;
    const { children, fallback } = this.props;

    if (hasError && error) {
      const errorType = classifyError(error);
      if (fallback) {
        return fallback({ error, reset: this.reset, errorType });
      }
      return (
        <ErrorFallback error={error} reset={this.reset} errorType={errorType} />
      );
    }

    return children;
  }
}

interface ErrorFallbackProps {
  error: Error;
  reset: () => void;
  errorType: ErrorType;
}

export function ErrorFallback({ error, reset, errorType }: ErrorFallbackProps) {
  const router = useRouter();
  const copy = ERROR_COPY[errorType];

  const handleRecovery = () => {
    if (errorType === 'auth') {
      router.push('/wallet/connect');
      return;
    }
    reset();
  };

  return (
    <div
      role="alert"
      className="flex min-h-[320px] flex-col items-center justify-center gap-4 p-8 text-center"
    >
      <h2 className="text-xl font-semibold">{copy.title}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{copy.description}</p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleRecovery}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          {errorType === 'auth' ? 'Connect wallet' : 'Try again'}
        </button>
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

export default ErrorBoundary;
