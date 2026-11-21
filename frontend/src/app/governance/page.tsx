'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { adminApi } from '@/lib/api/admin'
import {
  auditEntriesToProposals,
  type GovernanceAuditProposal,
} from '@/lib/governance/audit-proposals'
import { useAuth } from '@/lib/hooks/useAuth'

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

export default function GovernancePage() {
  const { jwt } = useAuth()
  const [proposals, setProposals] = useState<GovernanceAuditProposal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load proposals'))
      .finally(() => setLoading(false))
  }, [jwt])

  useEffect(() => { load() }, [load])

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Governance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pending and historical on-chain parameter changes.
          </p>
        </div>
        <Link href="/docs/voting" className="text-sm text-primary underline underline-offset-2">
          How voting works
        </Link>
      </header>

      {!jwt && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Sign in with your wallet to load governance proposals.
          </CardContent>
        </Card>
      )}

      {jwt && loading && (
        <Card>
          <CardContent className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading proposals" />
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

      {jwt && !loading && !error && proposals.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No parameter change proposals found yet.
          </CardContent>
        </Card>
      )}

      {jwt && proposals.length > 0 && (
        <section aria-label="Governance proposals" className="space-y-3">
          {proposals.map((proposal) => (
            <Card key={proposal.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{proposal.title}</CardTitle>
                    <CardDescription className="mt-1 text-xs">
                      {proposal.actionType} · Proposed by{' '}
                      <span className="font-mono">{proposal.proposer}</span>
                      {' · '}
                      <time dateTime={proposal.timestamp}>{formatTimestamp(proposal.timestamp)}</time>
                    </CardDescription>
                  </div>
                  <Badge variant="secondary">{proposal.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-3">
                <Button asChild variant="link" size="sm" className="px-0">
                  <Link href={`/governance/proposals?id=${encodeURIComponent(proposal.id)}`}>
                    View details and discussion
                  </Link>
                </Button>
                {proposal.eventUrl ? (
                  <a
                    href={proposal.eventUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2"
                  >
                    View on-chain event <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">On-chain event not indexed</span>
                )}
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </main>
  )
}
