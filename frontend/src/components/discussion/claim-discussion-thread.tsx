'use client'

import { useCallback, useEffect, useState } from 'react'
import { getConfig } from '@/config/env'
import { apiFetch } from '@/lib/api/fetch'
import { useAuth } from '@/lib/hooks/useAuth'
import { useWallet } from '@/hooks/use-wallet'
import { EntityDiscussionThread, type DiscussionComment } from './entity-discussion-thread'

interface ClaimCommentDto {
  id: string
  authorAddress: string
  authorDisplayName?: string | null
  body: string
  createdAt: string
  deletedAt?: string | null
}

type ClaimCommentsResponse = ClaimCommentDto[] | { items: ClaimCommentDto[]; nextCursor?: string | null }

const PAGE_SIZE = 20

function commentsUrl(claimId: string, suffix = '') {
  return `${getConfig().apiUrl}/claims/${encodeURIComponent(claimId)}/comments${suffix}`
}

function toDiscussionComment(c: ClaimCommentDto): DiscussionComment {
  return {
    id: c.id,
    authorLabel: c.authorDisplayName || c.authorAddress,
    authorAddress: c.authorAddress,
    body: c.body,
    createdAt: c.createdAt,
    deleted: Boolean(c.deletedAt),
  }
}

export interface ClaimDiscussionThreadProps {
  claimId: string
  /** Admins may remove any comment; authors may remove their own. */
  isAdmin?: boolean
}

/**
 * Claim discussion thread with cursor pagination, reply rate limiting and
 * soft-delete moderation.
 */
export function ClaimDiscussionThread({ claimId, isAdmin = false }: ClaimDiscussionThreadProps) {
  const { jwt } = useAuth()
  const { address } = useWallet()
  const [comments, setComments] = useState<DiscussionComment[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadPage = useCallback(
    async (after: string | null) => {
      const q = new URLSearchParams({ limit: String(PAGE_SIZE) })
      if (after) q.set('cursor', after)
      const res = await apiFetch<ClaimCommentsResponse>(commentsUrl(claimId, `?${q}`))
      const items = Array.isArray(res) ? res : res.items
      setComments((prev) => {
        const seen = new Set(prev.map((c) => c.id))
        return [...prev, ...items.map(toDiscussionComment).filter((c) => !seen.has(c.id))]
      })
      setCursor(Array.isArray(res) ? null : res.nextCursor ?? null)
    },
    [claimId],
  )

  useEffect(() => {
    setComments([])
    setCursor(null)
    loadPage(null).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load comments'))
  }, [loadPage])

  async function handleLoadMore() {
    if (!cursor) return
    setLoadingMore(true)
    try {
      await loadPage(cursor)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load comments')
    } finally {
      setLoadingMore(false)
    }
  }

  async function handlePost(body: string) {
    if (!jwt) {
      setError('Sign in to join the discussion.')
      return
    }
    setPosting(true)
    setError(null)
    try {
      const created = await apiFetch<ClaimCommentDto>(commentsUrl(claimId), {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      setComments((prev) => [...prev, toDiscussionComment(created)])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to post comment')
      throw e
    } finally {
      setPosting(false)
    }
  }

  async function handleRemove(id: string) {
    if (!jwt) return
    try {
      await apiFetch<void>(commentsUrl(claimId, `/${encodeURIComponent(id)}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${jwt}` },
      })
      setComments((prev) => prev.map((c) => (c.id === id ? { ...c, deleted: true } : c)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove comment')
    }
  }

  return (
    <EntityDiscussionThread
      entityId={`claim-${claimId}`}
      title="Claim discussion"
      description="Community discussion for this claim"
      comments={comments}
      onPostComment={handlePost}
      posting={posting}
      error={error}
      onLoadMore={handleLoadMore}
      hasMore={Boolean(cursor)}
      loadingMore={loadingMore}
      onRemoveComment={jwt ? handleRemove : undefined}
      canRemoveComment={(c) => isAdmin || (!!address && c.authorAddress === address)}
    />
  )
}
