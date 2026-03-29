'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ArrowLeft, ArrowRight, CheckCircle } from 'lucide-react';

import {
  Stepper,
  StepContent,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Button,
  useToast,
} from '@/components/ui';
import { useWallet } from '@/hooks/use-wallet';
import { ClaimAPI } from '@/lib/api/claim';

import { AmountStep } from './steps/AmountStep';
import { EvidenceStep } from './steps/EvidenceStep';
import { NarrativeStep } from './steps/NarrativeStep';
import { ReviewStep } from './steps/ReviewStep';

interface ClaimWizardProps {
  policyId: string;
  maxCoverage: string;
}

const STEPS = [
  { id: '1', title: 'Amount', description: 'Enter claim amount' },
  { id: '2', title: 'Narrative', description: 'Describe the incident' },
  { id: '3', title: 'Evidence', description: 'Upload proof' },
  { id: '4', title: 'Review', description: 'Confirm & Sign' },
];

export function ClaimWizard({ policyId, maxCoverage }: ClaimWizardProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { address, signTransaction } = useWallet();
  const [activeStep, setActiveStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [txStatus, setTxStatus] = useState<string>('');
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);

  const [formData, setFormData] = useState({
    amount: '',
    details: '',
    evidence: [] as { url: string; contentSha256Hex: string }[],
  });

  // Move focus to step heading when step changes
  useEffect(() => {
    if (stepHeadingRef.current) {
      stepHeadingRef.current.focus();
    }
  }, [activeStep]);

  const handleNext = () => {
    if (activeStep < STEPS.length - 1) {
      setActiveStep(prev => prev + 1);
    } else {
      handleFinalSubmit();
    }
  };

  const handleBack = () => {
    if (activeStep > 0) {
      setActiveStep(prev => prev - 1);
    } else {
      router.back();
    }
  };

  const handleFinalSubmit = async () => {
    if (!address) {
      toast({
        title: 'Wallet not connected',
        description: 'Please connect your wallet to sign the transaction.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      setTxStatus('Building transaction…');
      const { unsignedXdr } = await ClaimAPI.buildTransaction({
        holder: address,
        policyId: parseInt(policyId),
        amount: formData.amount,
        details: formData.details,
        evidence: formData.evidence,
      });

      setTxStatus('Waiting for wallet signature…');
      const signedXdr = await signTransaction(unsignedXdr);

      setTxStatus('Submitting transaction to network…');
      await ClaimAPI.submitTransaction(signedXdr);

      setTxStatus('Claim submitted successfully.');
      setIsSuccess(true);
      toast({
        title: 'Claim Submitted!',
        description: 'Your claim has been successfully filed on-chain.',
      });

      setTimeout(() => {
        router.push(`/policy/${policyId}`);
      }, 3000);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'An unexpected error occurred.';
      setTxStatus(`Submission failed: ${msg}`);
      console.error('Submission failed:', error);
      toast({
        title: 'Submission Failed',
        description: msg,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <Card className="mx-auto max-w-2xl text-center py-12">
        <CardContent className="space-y-6">
          <div
            className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/30"
            aria-hidden="true"
          >
            <CheckCircle className="h-12 w-12" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold">Claim Filed Successfully</h2>
            <p className="text-muted-foreground">
              Your claim has been broadcast to the network and is awaiting verification by the DAO.
            </p>
          </div>
          <Button onClick={() => router.push(`/policy/${policyId}`)}>
            Back to Policy
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-3xl">
      {/* Live region announces tx progress to screen readers */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {txStatus}
      </div>

      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-2xl">File a Claim</CardTitle>
            <CardDescription>
              Policy #{policyId} • Max Coverage: {maxCoverage} stroops
            </CardDescription>
          </div>
          <Stepper
            steps={STEPS.map((s, i) => ({ ...s, status: i < activeStep ? 'completed' : i === activeStep ? 'active' : 'pending' as const }))}
            currentStep={activeStep}
            aria-label="Claim filing steps"
            className="hidden md:flex"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Visually hidden heading receives focus on step change */}
        <h2
          ref={stepHeadingRef}
          tabIndex={-1}
          className="sr-only focus:not-sr-only focus:outline-none"
        >
          Step {activeStep + 1} of {STEPS.length}: {STEPS[activeStep].title}
        </h2>

        <StepContent title={STEPS[0].title} isActive={activeStep === 0} isCompleted={activeStep > 0}>
          <AmountStep
            amount={formData.amount}
            onChange={(val) => setFormData(prev => ({ ...prev, amount: val }))}
            maxCoverage={maxCoverage}
          />
        </StepContent>

        <StepContent title={STEPS[1].title} isActive={activeStep === 1} isCompleted={activeStep > 1}>
          <NarrativeStep
            details={formData.details}
            onChange={(val) => setFormData(prev => ({ ...prev, details: val }))}
          />
        </StepContent>

        <StepContent title={STEPS[2].title} isActive={activeStep === 2} isCompleted={activeStep > 2}>
          <EvidenceStep
            evidence={formData.evidence}
            onChange={(evidence) => setFormData(prev => ({ ...prev, evidence }))}
          />
        </StepContent>

        <StepContent title={STEPS[3].title} isActive={activeStep === 3} isCompleted={activeStep > 3}>
          <ReviewStep data={formData} policyId={policyId} />
        </StepContent>

        <div className="flex justify-between pt-4 border-t">
          <Button
            variant="ghost"
            onClick={handleBack}
            disabled={isSubmitting}
          >
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
            {activeStep === 0 ? 'Cancel' : 'Back'}
          </Button>
          <Button
            onClick={handleNext}
            disabled={
              isSubmitting ||
              (activeStep === 0 && !formData.amount) ||
              (activeStep === 1 && !formData.details) ||
              (activeStep === 3 && isSubmitting)
            }
            aria-busy={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Processing…
              </>
            ) : (
              <>
                {activeStep === STEPS.length - 1 ? 'Sign & Submit' : 'Next'}
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
