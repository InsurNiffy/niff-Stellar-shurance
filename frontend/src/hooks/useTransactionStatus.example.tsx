/**
 * Example: Using useTransactionStatus in a transaction flow
 * 
 * This demonstrates the pattern for policy initiation, claim filing,
 * and vote submission flows.
 */

import { useState } from 'react';
import { useTransactionStatus } from '@/hooks/useTransactionStatus';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

export function ExampleTransactionFlow() {
  const [txHash, setTxHash] = useState<string | null>(null);
  const { status, error, explorerUrl } = useTransactionStatus(txHash);

  const handleSubmit = async () => {
    try {
      // 1. Build transaction
      const { unsignedXdr } = await buildTransaction();
      
      // 2. Sign with wallet
      const signedXdr = await signTransaction(unsignedXdr);
      
      // 3. Submit to network
      const { transactionHash } = await submitTransaction(signedXdr);
      
      // 4. Start polling by setting txHash
      setTxHash(transactionHash);
      
    } catch (err) {
      console.error('Transaction failed:', err);
    }
  };

  // Render based on status
  if (status === 'SUCCESS') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-green-600">
          <CheckCircle className="h-5 w-5" />
          <span>Transaction confirmed!</span>
        </div>
        {explorerUrl && (
          <a href={explorerUrl} target="_blank" rel="noopener noreferrer">
            View on Explorer
          </a>
        )}
      </div>
    );
  }

  if (status === 'FAILED') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-red-600">
          <XCircle className="h-5 w-5" />
          <span>Transaction failed</span>
        </div>
        {error && <p className="text-sm text-muted-foreground">{error}</p>}
        {explorerUrl && (
          <a href={explorerUrl} target="_blank" rel="noopener noreferrer">
            View on Explorer
          </a>
        )}
      </div>
    );
  }

  if (status === 'NOT_FOUND_TIMEOUT') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-yellow-600">
          <AlertTriangle className="h-5 w-5" />
          <span>Transaction not found</span>
        </div>
        <p className="text-sm text-muted-foreground">
          The transaction was submitted but could not be confirmed within the expected timeframe.
          It may still be processing. Please check your wallet or try again later.
        </p>
      </div>
    );
  }

  if (status === 'pending') {
    return (
      <div className="flex items-center gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Confirming transaction on-chain...</span>
      </div>
    );
  }

  return (
    <Button onClick={handleSubmit}>
      Submit Transaction
    </Button>
  );
}

// Mock functions for example
async function buildTransaction() {
  return { unsignedXdr: 'mock-xdr' };
}

async function signTransaction(xdr: string) {
  return 'signed-xdr';
}

async function submitTransaction(xdr: string) {
  return { transactionHash: 'mock-hash' };
}
