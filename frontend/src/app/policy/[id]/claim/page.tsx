'use client';

import { AlertCircle, ArrowLeft } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';

import { ClaimWizard } from '@/components/claims/ClaimWizard';
import { Button, Card, CardContent, Skeleton } from '@/components/ui';
import { PolicyAPI } from '@/lib/api/policy';
import { Policy } from '@/lib/schemas/policy';


export default function FileClaimPage() {
  const params = useParams();
  const router = useRouter();
  const policyId = params.id as string;

  const [policy, setPolicy] = useState<Policy | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadPolicy() {
      try {
        const data = await PolicyAPI.getPolicy(policyId);
        setPolicy(data);
      } catch (err) {
        console.error('Failed to load policy:', err);
        setError('Could not load policy details. Please ensure the policy exists and you have access.');
      } finally {
        setIsLoading(false);
      }
    }

    if (policyId) {
      loadPolicy();
    }
  }, [policyId]);

  if (isLoading) {
    return (
      <div className="container max-w-3xl py-10 space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (error || !policy) {
    return (
      <div className="container max-w-3xl py-20">
        <Card className="border-destructive/50 bg-destructive/10">
          <CardContent className="pt-6 text-center space-y-4">
            <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
            <div className="space-y-2">
              <h2 className="text-xl font-bold">Error Loading Policy</h2>
              <p className="text-muted-foreground">{error}</p>
            </div>
            <Button onClick={() => router.push('/dashboard')} variant="outline">
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl py-10 space-y-6">
      <div className="flex items-center gap-4">
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => router.back()}
          className="h-9 w-9"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">File Insurance Claim</h1>
      </div>

      <ClaimWizard 
        policyId={policyId} 
        maxCoverage={policy.coverageAmount.toString()}
        policyCoverage={{
          coverageAmount: policy.coverageAmount,
          currency: policy.currency,
          status: policy.status,
          expiresAt: policy.expiresAt,
        }}
      />
    </div>
  );
}
