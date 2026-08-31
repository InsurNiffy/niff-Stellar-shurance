'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, ShieldAlert, Vote } from 'lucide-react'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAuth } from '@/lib/hooks/useAuth'
import { adminApi, type GovernanceProposal, type ProposalStatus } from '@/lib/api/admin'
import { GovernanceProposalDiscussion } from '@/components/governance/governance-proposal-discussion'

function isStaff(jwt: string | null): boolean {
  if (!jwt) return false
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload?.role === 'admin' || payload?.isAdmin === true
  } catch {
    return false
  }
}

function statusVariant(status: ProposalStatus): 'success' | 'destructive' | 'secondary' | 'info' {
  switch (status) {
    case 'passed':
    case 'executed':
      return 'success'
    case 'rejected':
      return 'destructive'
    case 'active':
      return 'info'
    default:
      return 'secondary'
  }
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

function authorFromJwt(jwt: string): string {
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

export default function GovernanceProposalsPage() {
  const { jwt } = useAuth()
  const staff = isStaff(jwt)

  if (!jwt) {
    return (
      <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <ShieldAlert className="h-12 w-12 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-xl font-semibold">Authentication required</h1>
        <p className="text-sm text-muted-foreground">Connect your wallet and sign in to view governance proposals.</p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Governance Proposals</h1>
          <p className="text-sm text-muted-foreground mt-1">Active on-chain governance proposals and voting status.</p>
        </div>
        <Link href="/admin" className="text-sm text-primary underline underline-offset-2">Back to dashboard</Link>
      </div>
      <ProposalList jwt={jwt} author={authorFromJwt(jwt)} />
      {staff && <CreateProposalForm jwt={jwt} />}
    </main>
  )
}

function ProposalList({ jwt, author }: { jwt: string; author: string }) {
  const [proposals, setProposals] = useState<GovernanceProposal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    adminApi.listProposals(jwt)
      .then(setProposals)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load proposals'))
      .finally(() => setLoading(false))
  }, [jwt])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <Card>
        <CardContent className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading proposals" />
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center space-y-3">
          <p className="text-sm text-destructive" role="alert">{error}</p>
          <Button variant="outline" size="sm" onClick={load}>Try again</Button>
        </CardContent>
      </Card>
    )
  }

  if (proposals.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
          <Vote className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">No governance proposals found.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {proposals.map((p) => {
        const totalVotes = p.yesVotes + p.noVotes
        const approvePct = totalVotes > 0 ? Math.round((p.yesVotes / totalVotes) * 100) : 0
        const quorumReached = totalVotes >= p.quorumRequired

        return (
          <Card key={p.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="text-base">{p.title}</CardTitle>
                  <CardDescription className="text-xs">
                    Proposed by <span className="font-mono">{p.proposer.slice(0, 8)}...{p.proposer.slice(-4)}</span>
                    {' '}&middot; {formatDate(p.createdAt)}
                  </CardDescription>
                </div>
                <Badge variant={statusVariant(p.status)}>
                  {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">{p.description}</p>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border bg-muted p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Parameter</p>
                  <p className="text-sm font-medium font-mono mt-1">{p.parameterKey}</p>
                </div>
                <div className="rounded-lg border bg-muted p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Proposed change</p>
                  <p className="text-sm mt-1">
                    <span className="text-muted-foreground">{p.currentValue}</span>
                    {' '}&rarr;{' '}
                    <span className="font-semibold">{p.proposedValue}</span>
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Votes: {p.yesVotes} yes / {p.noVotes} no ({totalVotes} total)</span>
                  <span>{quorumReached ? 'Quorum reached' : `${totalVotes}/${p.quorumRequired} for quorum`}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-green-500 transition-all"
                    style={{ width: `${approvePct}%` }}
                    role="progressbar"
                    aria-valuenow={approvePct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${approvePct}% approval`}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Voting deadline: {formatDate(p.votingDeadline)}</span>
                {quorumReached && <Badge variant="success">Quorum met</Badge>}
              </div>

              <GovernanceProposalDiscussion proposalId={p.id} author={author} />
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function CreateProposalForm({ jwt }: { jwt: string }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [parameterKey, setParameterKey] = useState('')
  const [proposedValue, setProposedValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function resetForm() {
    setTitle('')
    setDescription('')
    setParameterKey('')
    setProposedValue('')
    setError(null)
  }

  async function handleSubmit() {
    if (!title.trim() || !parameterKey.trim() || !proposedValue.trim()) {
      setError('Title, parameter key, and proposed value are required.')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const proposal = await adminApi.createProposal(jwt, {
        title: title.trim(),
        description: description.trim(),
        parameterKey: parameterKey.trim(),
        proposedValue: proposedValue.trim(),
      })
      setResult(`Proposal "${proposal.title}" created successfully.`)
      setOpen(false)
      resetForm()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create proposal')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Submit Proposal</CardTitle>
        <CardDescription>Create a new parameter change proposal for governance voting (admin only).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {result && <p className="text-sm text-green-700" role="status">{result}</p>}
        <Button variant="outline" size="sm" onClick={() => { setResult(null); setError(null); setOpen(true) }}>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          New proposal...
        </Button>

        <Dialog open={open} onOpenChange={(v) => !submitting && setOpen(v)}>
          <DialogContent aria-labelledby="proposal-title" aria-describedby="proposal-desc">
            <DialogHeader>
              <DialogTitle id="proposal-title">New governance proposal</DialogTitle>
              <DialogDescription id="proposal-desc">
                Submit a parameter change proposal. All eligible voters will be able to vote on it.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="proposal-name">Title</Label>
                <Input
                  id="proposal-name"
                  placeholder="e.g. Increase quorum threshold"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="proposal-description">Description</Label>
                <textarea
                  id="proposal-description"
                  rows={3}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Explain the rationale for this change..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="param-key">Parameter key</Label>
                  <Input
                    id="param-key"
                    placeholder="e.g. quorum_bps"
                    className="font-mono"
                    value={parameterKey}
                    onChange={(e) => setParameterKey(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="param-value">Proposed value</Label>
                  <Input
                    id="param-value"
                    placeholder="e.g. 5000"
                    value={proposedValue}
                    onChange={(e) => setProposedValue(e.target.value)}
                  />
                </div>
              </div>
              {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={submitting} aria-busy={submitting}>
                {submitting
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Submitting...</>
                  : 'Submit proposal'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
