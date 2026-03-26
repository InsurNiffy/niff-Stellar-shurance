'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Stepper, StepContent, Card, CardHeader, CardTitle, CardDescription, CardContent, Button, useToast } from '@/components/ui';
import { AmountStep } from './steps/AmountStep';
import { NarrativeStep } from './steps/NarrativeStep';
import { EvidenceStep } from './steps/EvidenceStep';
import { ReviewStep } from './steps/ReviewStep';
import { ClaimAPI } from '@/lib/api/claim';
import { useWallet } from '@/hooks/use-wallet'; // Assuming this exists based on common patterns
import { Loader2, ArrowLeft, ArrowRight, CheckCircle } from 'lucide-react';

interface ClaimWizardProps {
  policyId: string;
  maxCoverage: string;
}

const STEPS = [
  { label: 'Amount', description: 'Enter claim amount' },
  { label: 'Narrative', description: 'Describe the incident' },
  { label: 'Evidence', description: 'Upload proof' },
  { label: 'Review', description: 'Confirm & Sign' },
];

export function ClaimWizard({ policyId, maxCoverage }: ClaimWizardProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { address, signTransaction } = useWallet();
  const [activeStep, setActiveStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const [formData, setFormData] = useState({
    amount: '',
    details: '',
    imageUrls: [] as string[],
  });

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
      // 1. Build unsigned transaction on backend
      const { unsignedXdr } = await ClaimAPI.buildTransaction({
        holder: address,
        policyId: parseInt(policyId),
        amount: formData.amount,
        details: formData.details,
        imageUrls: formData.imageUrls,
      });

      // 2. Sign with wallet
      const signedXdr = await signTransaction(unsignedXdr);

      // 3. Submit signed transaction
      const result = await ClaimAPI.submitTransaction(signedXdr);

      // 4. Success handling
      setIsSuccess(true);
      toast({
        title: 'Claim Submitted!',
        description: 'Your claim has been successfully filed on-chain.',
      });

      // Redirect after a delay
      setTimeout(() => {
        router.push(`/policy/${policyId}`);
      }, 3000);
    } catch (error) {
      console.error('Submission failed:', error);
      toast({
        title: 'Submission Failed',
        description: error instanceof Error ? error.message : 'An unexpected error occurred.',
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
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/30">
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
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-2xl">File a Claim</CardTitle>
            <CardDescription>
              Policy #{policyId} • Max Coverage: {maxCoverage} stroops
            </CardDescription>
          </div>
          <Stepper steps={STEPS} activeStep={activeStep} className="hidden md:flex" />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <StepContent active={activeStep === 0}>
          <AmountStep 
            amount={formData.amount} 
            onChange={(val) => setFormData(prev => ({ ...prev, amount: val }))}
            maxCoverage={maxCoverage}
          />
        </StepContent>

        <StepContent active={activeStep === 1}>
          <NarrativeStep 
            details={formData.details} 
            onChange={(val) => setFormData(prev => ({ ...prev, details: val }))}
          />
        </StepContent>

        <StepContent active={activeStep === 2}>
          <EvidenceStep 
            imageUrls={formData.imageUrls} 
            onChange={(urls) => setFormData(prev => ({ ...prev, imageUrls: urls }))}
          />
        </StepContent>

        <StepContent active={activeStep === 3}>
          <ReviewStep data={formData} policyId={policyId} />
        </StepContent>

        <div className="flex justify-between pt-4 border-t">
          <Button 
            variant="ghost" 
            onClick={handleBack}
            disabled={isSubmitting}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
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
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                {activeStep === STEPS.length - 1 ? 'Sign & Submit' : 'Next'}
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
