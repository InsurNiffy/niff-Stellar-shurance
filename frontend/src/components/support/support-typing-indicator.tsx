'use client'

/**
 * Lightweight "support is typing" row for the ticket thread.
 * Renders nothing when inactive so tickets without composing staff stay quiet.
 */
export function SupportTypingIndicator({ isTyping }: { isTyping: boolean }) {
  if (!isTyping) return null

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="support-typing-indicator"
      className="flex items-center gap-2 px-1 py-2 text-sm text-muted-foreground"
    >
      <span className="inline-flex gap-1" aria-hidden="true">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
      </span>
      <span>Support is typing…</span>
    </div>
  )
}
