'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

export interface DiscussionComment {
  id: string
  authorLabel: string
  body: string
  createdAt: string
}

export interface EntityDiscussionThreadProps {
  entityId: string
  title: string
  comments: DiscussionComment[]
  onPostComment: (body: string) => Promise<void> | void
  posting?: boolean
  error?: string | null
  emptyMessage?: string
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
}: EntityDiscussionThreadProps) {
  const [draft, setDraft] = useState('')
  const sorted = useMemo(
    () => [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [comments],
  )

  async function handleSubmit() {
    if (!draft.trim() || posting) return
    await onPostComment(draft)
    setDraft('')
  }

  return (
    <section
      data-testid={`discussion-thread-${entityId}`}
      aria-label={`${title} discussion`}
      className="space-y-3 rounded-lg border bg-card p-4"
    >
      <header>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">Community discussion for this proposal</p>
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
                {' · '}
                {formatWhen(comment.createdAt)}
              </p>
              <p className="whitespace-pre-wrap">{comment.body}</p>
            </li>
          ))
        )}
      </ul>

      <div className="space-y-2">
        <Label htmlFor={`discussion-input-${entityId}`} className="sr-only">
          Add a comment
        </Label>
        <textarea
          id={`discussion-input-${entityId}`}
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Share your thoughts on this proposal…"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={posting}
        />
        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button type="button" size="sm" onClick={handleSubmit} disabled={posting || !draft.trim()}>
          {posting ? 'Posting…' : 'Post comment'}
        </Button>
      </div>
    </section>
  )
}
