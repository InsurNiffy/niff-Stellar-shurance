'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { GovernanceProposalDiscussion } from '@/components/governance/governance-proposal-discussion'
import { adminApi } from '@/lib/api/admin'
import {
  auditEntriesToProposals,
  type GovernanceAuditProposal,
} from '@/lib/governance/audit-proposals'
import { useAuth } from '@/lib/hooks/useAuth'

interface GovernanceProposalsPageProps {
  searchParams?: { id?: string } | Promise<{ id?: string }>
}

function authorFromJwt(jwt: string | null): string {
  if (!jwt) return 'Community member'
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as {
      sub?: string
      wallet?: string
      address?: string
    }
    return payload.sub ?? payload.wallet ?? payload.address ?? 'Community member'
  } catch {
    return 'Community member'
  }
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

export default function GovernanceProposalsPage({ searchParams }: GovernanceProposalsPageProps) {
  const { jwt } = useAuth()
  const [requestedId, setRequestedId] = useState<string | null>(
    searchParams && !('then' in searchParams) ? searchParams.id ?? null : null,
  )
  const [proposals, setProposals] = useState<GovernanceAuditProposal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (requestedId) return
    const fromUrl = new URLSearchParams(window.location.search).get('id')
    if (fromUrl) setRequestedId(fromUrl)
  }, [requestedId])

  const load = useCallback(() => {
    if (!jwt) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    adminApi
      .getAudits(jwt, { limit: 100 })
      .then((page) => setProposals(auditEntriesToProposals(page.items)))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load proposal'))
      .finally(() => setLoading(false))
  }, [jwt])

  useEffect(() => { load() }, [load])

  const proposal = requestedId
    ? proposals.find((p) => p.id === requestedId) ?? proposals[0]
    : proposals[0]

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8" data-tour="governance">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Proposal details</h1>
          <p className="mt-1 text-sm text-muted-foreground">On-chain parameter change and discussion.</p>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <Link href="/governance" className="text-primary underline underline-offset-2">
            All proposals
          </Link>
          <Link href="/docs/voting" className="text-primary underline underline-offset-2">
            Voting docs
          </Link>
        </div>
      </header>

      {!jwt && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Connect your wallet and sign in to load proposal details and join the discussion.
          </CardContent>
        </Card>
      )}

      {jwt && loading && (
        <Card>
          <CardContent className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading proposal" />
          </CardContent>
        </Card>
      )}

      {jwt && error && (
        <Card>
          <CardContent className="space-y-3 py-8 text-center">
            <p className="text-sm text-destructive" role="alert">{error}</p>
            <Button variant="outline" size="sm" onClick={load}>Try again</Button>
          </CardContent>
        </Card>
      )}

      {jwt && !loading && !error && !proposal && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Proposal not found.
          </CardContent>
        </Card>
      )}

      {proposal && (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>{proposal.title}</CardTitle>
                  <CardDescription className="mt-1">{proposal.actionType}</CardDescription>
                </div>
                <Badge variant="secondary">{proposal.status}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Proposer</dt>
                  <dd className="mt-1 font-mono break-all">{proposal.proposer}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Timestamp</dt>
                  <dd className="mt-1">
                    <time dateTime={proposal.timestamp}>{formatTimestamp(proposal.timestamp)}</time>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Action type</dt>
                  <dd className="mt-1">{proposal.actionType}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Status</dt>
                  <dd className="mt-1 capitalize">{proposal.status}</dd>
                </div>
              </dl>

              {Object.keys(proposal.payload).length > 0 && (
                <div>
                  <h2 className="mb-2 text-sm font-medium">Parameter change</h2>
                  <dl className="space-y-1 rounded-md border bg-muted p-3 font-mono text-xs">
                    {Object.entries(proposal.payload).map(([key, value]) => (
                      <div key={key} className="flex flex-wrap justify-between gap-2">
                        <dt className="text-muted-foreground">{key}</dt>
                        <dd className="break-all text-right">
                          {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              {proposal.eventUrl && (
                <a
                  href={proposal.eventUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary underline underline-offset-2"
                >
                  View on-chain event <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              )}
            </CardContent>
          </Card>

          <GovernanceProposalDiscussion
            proposalId={proposal.id}
            author={authorFromJwt(jwt)}
          />
        </>
      )}
    </main>
  )
}
