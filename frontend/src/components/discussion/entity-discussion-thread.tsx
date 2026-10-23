'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

export interface DiscussionComment {
  id: string
  authorLabel: string
  /** Commenter wallet address, shown alongside the display name. */
  authorAddress?: string
  body: string
  createdAt: string
  /** Soft-deleted comments render as a `[removed]` placeholder. */
  deleted?: boolean
}

export const COMMENT_MAX_LENGTH = 500
export const REPLY_COOLDOWN_MS = 60_000

function shortAddress(address: string) {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

export interface EntityDiscussionThreadProps {
  entityId: string
  title: string
  comments: DiscussionComment[]
  onPostComment: (body: string) => Promise<void> | void
  posting?: boolean
  error?: string | null
  emptyMessage?: string
  /** Cursor-based pagination: called to fetch the next page of comments. */
  onLoadMore?: () => Promise<void> | void
  hasMore?: boolean
  loadingMore?: boolean
  /** Moderation: when provided, a remove action is shown on each comment. */
  onRemoveComment?: (id: string) => Promise<void> | void
  canRemoveComment?: (comment: DiscussionComment) => boolean
  description?: string
}

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  )
}

/**
 * Reusable discussion thread UI (pattern aligned with support ticket threads).
 */
export function EntityDiscussionThread({
  entityId,
  title,
  comments,
  onPostComment,
  posting = false,
  error = null,
  emptyMessage = 'No comments yet. Start the discussion.',
  onLoadMore,
  hasMore = false,
  loadingMore = false,
  onRemoveComment,
  canRemoveComment,
  description = 'Community discussion for this proposal',
}: EntityDiscussionThreadProps) {
  const [draft, setDraft] = useState('')
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const cooldownSeconds = Math.max(0, Math.ceil((cooldownUntil - now) / 1000))

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return
    const timer = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (t >= cooldownUntil) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [cooldownUntil])

  const sorted = useMemo(
    () => [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [comments],
  )

  async function handleSubmit() {
    if (!draft.trim() || posting || cooldownSeconds > 0 || draft.length > COMMENT_MAX_LENGTH) return
    try {
      await onPostComment(draft)
    } catch {
      return
    }
    setDraft('')
    const t = Date.now()
    setNow(t)
    setCooldownUntil(t + REPLY_COOLDOWN_MS)
  }

  return (
    <section
      data-testid={`discussion-thread-${entityId}`}
      aria-label={`${title} discussion`}
      className="space-y-3 rounded-lg border bg-card p-4"
    >
      <header>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </header>

      <ul className="space-y-2" aria-label="Comments">
        {sorted.length === 0 ? (
          <li className="text-sm text-muted-foreground">{emptyMessage}</li>
        ) : (
          sorted.map((comment) => (
            <li
              key={comment.id}
              data-testid={`discussion-comment-${comment.id}`}
              className="rounded-md border px-3 py-2 text-sm"
            >
              <p className="mb-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{comment.authorLabel}</span>
                {comment.authorAddress && comment.authorAddress !== comment.authorLabel && (
                  <span className="ml-1 font-mono" title={comment.authorAddress}>
                    ({shortAddress(comment.authorAddress)})
                  </span>
                )}
                {' · '}
                {formatWhen(comment.createdAt)}
                {onRemoveComment && !comment.deleted && (canRemoveComment?.(comment) ?? true) && (
                  <button
                    type="button"
                    className="ml-2 text-destructive underline-offset-2 hover:underline"
                    onClick={() => onRemoveComment(comment.id)}
                  >
                    Remove
                  </button>
                )}
              </p>
              {comment.deleted ? (
                <p className="italic text-muted-foreground">[removed]</p>
              ) : (
                <p className="whitespace-pre-wrap">{comment.body}</p>
              )}
            </li>
          ))
        )}
      </ul>

      {onLoadMore && hasMore && (
        <Button type="button" variant="outline" size="sm" onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Load more comments'}
        </Button>
      )}

      <div className="space-y-2">
        <Label htmlFor={`discussion-input-${entityId}`} className="sr-only">
          Add a comment
        </Label>
        <textarea
          id={`discussion-input-${entityId}`}
          rows={3}
          value={draft}
          maxLength={COMMENT_MAX_LENGTH}
          aria-describedby={`discussion-count-${entityId}`}
          onChange={(e) => setDraft(e.target.value.slice(0, COMMENT_MAX_LENGTH))}
          placeholder="Share your thoughts on this proposal…"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={posting}
        />
        <p id={`discussion-count-${entityId}`} className="text-right text-xs text-muted-foreground">
          {draft.length}/{COMMENT_MAX_LENGTH}
        </p>
        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button
          type="button"
          size="sm"
          onClick={handleSubmit}
          disabled={posting || !draft.trim() || cooldownSeconds > 0}
        >
          {posting ? 'Posting…' : cooldownSeconds > 0 ? `Reply in ${cooldownSeconds}s` : 'Post comment'}
        </Button>
      </div>
    </section>
  )
}
