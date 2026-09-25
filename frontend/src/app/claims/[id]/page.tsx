'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import ClaimDetail from '../../../../components/claims/ClaimDetail';
import ClaimTimeline from '../../../../components/claims/ClaimTimeline';
import EvidenceViewer from '../../../../components/claims/EvidenceViewer';
import { useClaim } from '../../../../src/features/claims/useClaim';
import { useClaimVote } from '../../../../src/features/claims/useClaimVote';
import { useVoterEligibility } from '../../../../src/features/claims/useVoterEligibility';
import VotePanel from '../../../../components/claims/VotePanel';

export default function ClaimDetailPage() {
  const params = useParams<{ id: string }>();
  const claimId = params?.id;

  const { claim, isLoading, error, refetch } = useClaim(claimId);
  const { eligibility, isLoading: isEligibilityLoading } = useVoterEligibility(claimId);
  const { vote, isSubmitting, error: voteError } = useClaimVote(claimId);

  const [optimisticTally, setOptimisticTally] = useState<{
    approve: number;
    reject: number;
  } | null>(null);

  useEffect(() => {
    setOptimisticTally(null);
  }, [claim?.approveCount, claim?.rejectCount]);

  const tally = useMemo(() => {
    if (optimisticTally) return optimisticTally;
    return {
      approve: claim?.approveCount ?? 0,
      reject: claim?.rejectCount ?? 0,
    };
  }, [claim?.approveCount, claim?.rejectCount, optimisticTally]);

  const handleVote = useCallback(
    async (choice: 'approve' | 'reject') => {
      setOptimisticTally({
        approve: tally.approve + (choice === 'approve' ? 1 : 0),
        reject: tally.reject + (choice === 'reject' ? 1 : 0),
      });
      try {
        await vote(choice);
        await refetch();
      } catch {
        setOptimisticTally(null);
      }
    },
    [refetch, tally.approve, tally.reject, vote],
  );

  if (isLoading) {
    return <div className="p-6 text-sm text-gray-500">Loading claim…</div>;
  }

  if (error || !claim) {
    return (
      <div className="p-6 text-sm text-red-600">
        {error ?? 'Claim not found.'}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <ClaimDetail claim={claim} />

      <VotePanel
        claim={claim}
        tally={tally}
        eligibility={eligibility}
        isEligibilityLoading={isEligibilityLoading}
        isSubmitting={isSubmitting}
        error={voteError}
        onVote={handleVote}
      />

      <EvidenceViewer claimId={claim.id} evidence={claim.evidence} />

      <ClaimTimeline claimId={claim.id} events={claim.timeline} />
    </div>
  );
}
