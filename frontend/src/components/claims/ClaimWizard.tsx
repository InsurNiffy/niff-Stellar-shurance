'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, ArrowLeft, ArrowRight, CheckCircle, ExternalLink } from 'lucide-react';

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
import { useDraftPersistence } from '@/hooks/use-draft-persistence';
import { ClaimAPI } from '@/lib/api/claim';
import { trackClaimFiled } from '@/lib/analytics';

import { EvidenceStep, type EvidenceAttachment } from './steps/EvidenceStep';
import { DetailsStep } from './steps/DetailsStep';
import { ReviewStep, type PolicyCoverageDetails } from './steps/ReviewStep';
import { DraftResumeBanner } from './DraftResumeBanner';

interface ClaimWizardProps {
  policyId: string;
  maxCoverage: string;
  policyCoverage?: PolicyCoverageDetails;
}

const STEPS = [
  { id: '1', title: 'Evidence', description: 'Upload proof' },
  { id: '2', title: 'Details', description: 'Amount & narrative' },
  { id: '3', title: 'Sign & Submit', description: 'Confirm & sign' },
];

const CLAIM_DRAFT_SCHEMA_VERSION = 2;

export function ClaimWizard({ policyId, maxCoverage, policyCoverage }: ClaimWizardProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { address, signTransaction } = useWallet();
  const [activeStep, setActiveStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false); // duplicate-submission guard
  const [claimId, setClaimId] = useState<number | null>(null);
  const [txStatus, setTxStatus] = useState<string>('');
  const [showBanner, setShowBanner] = useState(true);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);

  // Contract config for min/max evidence
  const [minEvidence, setMinEvidence] = useState(1);
  const [maxEvidence, setMaxEvidence] = useState(5);

  const [formData, setFormData] = useState({
    amount: '',
    details: '',
    evidence: [] as EvidenceAttachment[],
  });

  const { hasDraft, saveDraft, loadDraft, clearDraft } = useDraftPersistence(
    `claim-${policyId}`,
    CLAIM_DRAFT_SCHEMA_VERSION,
  );

  // Fetch contract config on mount
  useEffect(() => {
    ClaimAPI.getConfig()
      .then((cfg) => {
        setMinEvidence(cfg.minEvidenceCount);
        setMaxEvidence(cfg.maxEvidenceCount);
      })
      .catch(() => {
        // Non-fatal: fall back to defaults (1–5)
      });
  }, []);

  // Persist draft on form changes
  useEffect(() => {
    if (activeStep > 0 || formData.amount || formData.details || formData.evidence.length > 0) {
      saveDraft({ ...formData, _step: activeStep });
    }
  }, [formData, activeStep, saveDraft]);

  // Focus step heading on step change
  useEffect(() => {
    stepHeadingRef.current?.focus();
  }, [activeStep]);

  const handleResumeDraft = () => {
    const draft = loadDraft();
    if (draft) {
      const { _step, ...data } = draft as Record<string, unknown> & { _step?: number };
      setFormData(prev => ({ ...prev, ...(data as Partial<typeof formData>) }));
      if (typeof _step === 'number') setActiveStep(_step);
      toast({ title: 'Draft Restored', description: 'Continuing where you left off.' });
    }
    setShowBanner(false);
  };

  const handleDismissBanner = () => {
    clearDraft();
    setShowBanner(false);
  };

  const canAdvanceFromStep = (step: number): boolean => {
    if (step === 0) return formData.evidence.length >= minEvidence;
    if (step === 1) return !!formData.amount && !!formData.details;
    return true;
  };

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
    if (submittingRef.current) return; // prevent duplicate submissions
    if (!address) {
      toast({
        title: 'Wallet not connected',
        description: 'Please connect your wallet to sign the transaction.',
        variant: 'destructive',
      });
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      setTxStatus('Building transaction…');
      const { unsignedXdr } = await ClaimAPI.buildTransaction({
        holder: address,
        policyId: parseInt(policyId),
        amount: formData.amount,
        details: formData.details,
        evidence: formData.evidence.map(({ url, contentSha256Hex }) => ({ url, contentSha256Hex })),
      });

      setTxStatus('Waiting for wallet signature…');
      const signedXdr = await signTransaction(unsignedXdr);

      setTxStatus('Submitting transaction to network…');
      const result = await ClaimAPI.submitTransaction(signedXdr);

      setTxStatus('Claim submitted successfully.');
      setClaimId(result.claimId);

      trackClaimFiled();
      clearDraft();

      toast({
        title: 'Claim Submitted!',
        description: `Claim #${result.claimId} has been filed on-chain.`,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'An unexpected error occurred.';
      setTxStatus(`Submission failed: ${msg}`);
      toast({ title: 'Submission Failed', description: msg, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
      submittingRef.current = false;
    }
  };

  if (claimId !== null) {
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
              Your claim has been broadcast to the network and is awaiting DAO verification.
            </p>
            <p className="text-sm font-mono font-semibold">Claim ID: #{claimId}</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild>
              <Link href={`/claims/${claimId}`}>
                View Claim <ExternalLink className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button variant="outline" onClick={() => router.push('/policies')}>
              Back to Policies
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-3xl">
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
            steps={STEPS.map((s, i) => ({
              ...s,
              status: (i < activeStep ? 'completed' : i === activeStep ? 'active' : 'pending') as
                | 'completed'
                | 'active'
                | 'pending',
            }))}
            currentStep={activeStep}
            aria-label="Claim filing steps"
            className="hidden md:flex"
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {hasDraft && showBanner && (
          <DraftResumeBanner onConfirm={handleResumeDraft} onDismiss={handleDismissBanner} />
        )}

        <h2
          ref={stepHeadingRef}
          tabIndex={-1}
          className="sr-only focus:not-sr-only focus:outline-none"
        >
          Step {activeStep + 1} of {STEPS.length}: {STEPS[activeStep].title}
        </h2>

        {/* Step 0: Evidence */}
        <StepContent title={STEPS[0].title} isActive={activeStep === 0} isCompleted={activeStep > 0}>
          <EvidenceStep
            evidence={formData.evidence}
            onChange={(evidence) => setFormData(prev => ({ ...prev, evidence }))}
            minEvidence={minEvidence}
            maxEvidence={maxEvidence}
          />
        </StepContent>

        {/* Step 1: Details (amount + narrative) */}
        <StepContent title={STEPS[1].title} isActive={activeStep === 1} isCompleted={activeStep > 1}>
          <DetailsStep
            amount={formData.amount}
            details={formData.details}
            onAmountChange={(amount) => setFormData(prev => ({ ...prev, amount }))}
            onDetailsChange={(details) => setFormData(prev => ({ ...prev, details }))}
            maxCoverage={maxCoverage}
          />
        </StepContent>

        {/* Step 2: Review + Sign */}
        <StepContent title={STEPS[2].title} isActive={activeStep === 2} isCompleted={activeStep > 2}>
          <ReviewStep
            data={formData}
            policyId={policyId}
            policyCoverage={policyCoverage}
            deductible={policyCoverage?.deductible ?? '0'}
            onEdit={(step) => setActiveStep(step)}
          />
        </StepContent>

        <div className="flex justify-between pt-4 border-t">
          <Button variant="ghost" onClick={handleBack} disabled={isSubmitting}>
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
            {activeStep === 0 ? 'Cancel' : 'Back'}
          </Button>
          <Button
            onClick={handleNext}
            disabled={isSubmitting || !canAdvanceFromStep(activeStep)}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Processing…
              </>
            ) : (
              <>
                {activeStep === STEPS.length - 1 ? 'Confirm & Sign' : 'Next'}
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
