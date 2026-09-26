'use client'

import { useCallback, useEffect, useState } from 'react'

import { EntityDiscussionThread } from '@/components/discussion/entity-discussion-thread'
import {
  addProposalComment,
  listProposalComments,
  type ProposalComment,
} from '@/lib/governance/proposal-comments'

interface GovernanceProposalDiscussionProps {
  proposalId: string
  author: string
}

export function GovernanceProposalDiscussion({
  proposalId,
  author,
}: GovernanceProposalDiscussionProps) {
  const [comments, setComments] = useState<ProposalComment[]>([])
  const [loading, setLoading] = useState(true)
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    try {
      setComments(listProposalComments(proposalId))
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load comments')
    } finally {
      setLoading(false)
    }
  }, [proposalId])

  useEffect(() => {
    load()
  }, [load])

  async function handlePost(body: string) {
    setPosting(true)
    setError(null)
    try {
      addProposalComment(proposalId, author, body)
      load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to post comment')
    } finally {
      setPosting(false)
    }
  }

  if (loading) {
    return (
      <p className="text-xs text-muted-foreground" data-testid={`discussion-loading-${proposalId}`}>
        Loading discussion…
      </p>
    )
  }

  return (
    <EntityDiscussionThread
      entityId={proposalId}
      title="Proposal discussion"
      comments={comments.map((c) => ({
        id: c.id,
        authorLabel: c.author,
        body: c.body,
        createdAt: c.createdAt,
      }))}
      onPostComment={handlePost}
      posting={posting}
      error={error}
    />
  )
}
