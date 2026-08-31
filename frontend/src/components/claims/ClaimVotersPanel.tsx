'use client'

import { useQuery } from '@tanstack/react-query'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ClaimsListSkeleton } from '@/features/claims/components/ClaimsSkeleton'
import { fetchClaimVoters, type ClaimVoter } from '@/lib/api/claim-detail'

interface ClaimVotersPanelProps {
  claimId: string
}

function VoterRow({ voter }: { voter: ClaimVoter }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium tabular-nums">
          {voter.displayName ?? voter.walletAddress}
        </p>
        {voter.displayName && (
          <p className="truncate text-xs text-muted-foreground tabular-nums">
            {voter.walletAddress}
          </p>
        )}
      </div>
      <div className="shrink-0">
        {voter.voted ? (
          <Badge
            variant={voter.vote === 'yes' ? 'success' : 'destructive'}
            aria-label={`Voted ${voter.vote}`}
          >
            Voted {voter.vote === 'yes' ? 'Yes' : 'No'}
          </Badge>
        ) : (
          <Badge variant="outline" aria-label="Not voted">
            Not voted
          </Badge>
        )}
      </div>
    </div>
  )
}

export function ClaimVotersPanel({ claimId }: ClaimVotersPanelProps) {
  const {
    data: voters,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['claim-voters', claimId],
    queryFn: () => fetchClaimVoters(claimId),
    retry: false,
  })

  const votedCount = voters?.filter((v) => v.voted).length ?? 0
  const totalCount = voters?.length ?? 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Voters</CardTitle>
            <CardDescription>
              Eligible voter snapshot from the on-chain registry with vote status.
            </CardDescription>
          </div>
          {!isLoading && !isError && voters && (
            <p className="text-sm text-muted-foreground tabular-nums">
              {votedCount}/{totalCount} voted
            </p>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && <ClaimsListSkeleton rows={3} />}
        {isError && (
          <p className="text-sm text-muted-foreground">Could not load voter list.</p>
        )}
        {voters && voters.length === 0 && (
          <p className="text-sm text-muted-foreground">No eligible voters found.</p>
        )}
        {voters && voters.length > 0 && (
          <div className="space-y-2">
            {voters.map((voter) => (
              <VoterRow key={voter.walletAddress} voter={voter} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
