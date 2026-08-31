'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { getConfig } from '@/config/env'

export interface TicketTypingState {
  ticketId: string
  isTyping: boolean
  staffId: string | null
  updatedAt: number
  expiresAt: number
}

/**
 * Subscribes to the ticket typing SSE channel (with a short poll fallback)
 * and returns whether support staff is currently composing a reply.
 */
export function useTicketTyping(ticketId: string | null | undefined): {
  isTyping: boolean
  refresh: () => void
} {
  const [isTyping, setIsTyping] = useState(false)
  const ticketIdRef = useRef(ticketId)
  ticketIdRef.current = ticketId

  const apply = useCallback((state: TicketTypingState | null) => {
    if (!state || state.ticketId !== ticketIdRef.current) return
    setIsTyping(Boolean(state.isTyping))
  }, [])

  const refresh = useCallback(() => {
    if (!ticketId) {
      setIsTyping(false)
      return
    }
    const base = getConfig().apiUrl
    fetch(`${base}/api/support/tickets/${ticketId}/typing`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: TicketTypingState | null) => apply(data))
      .catch(() => {
        /* ignore transient errors */
      })
  }, [ticketId, apply])

  useEffect(() => {
    if (!ticketId) {
      setIsTyping(false)
      return
    }

    const base = getConfig().apiUrl
    let eventSource: EventSource | null = null
    let pollId: ReturnType<typeof setInterval> | null = null
    let cancelled = false

    function startPoll() {
      if (pollId || cancelled) return
      pollId = setInterval(refresh, 2_000)
    }

    try {
      eventSource = new EventSource(`${base}/api/support/tickets/${ticketId}/events`)
      eventSource.onmessage = (ev) => {
        try {
          apply(JSON.parse(ev.data) as TicketTypingState)
        } catch {
          /* ignore malformed */
        }
      }
      eventSource.onerror = () => {
        eventSource?.close()
        eventSource = null
        startPoll()
      }
    } catch {
      startPoll()
    }

    // Initial snapshot in case SSE is slow to connect.
    refresh()

    return () => {
      cancelled = true
      eventSource?.close()
      if (pollId) clearInterval(pollId)
    }
  }, [ticketId, apply, refresh])

  return { isTyping, refresh }
}
