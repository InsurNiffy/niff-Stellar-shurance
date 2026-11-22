'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

import { TicketThread, type TicketThreadMessage } from '@/components/support/ticket-thread'
import {
  getSupportTicket,
  listSupportTicketReplies,
  type SupportTicketView,
} from '@/lib/api/support'

export default function SupportTicketPage() {
  const params = useParams<{ id: string }>()
  const ticketId = params?.id
  const [ticket, setTicket] = useState<SupportTicketView | null>(null)
  const [replies, setReplies] = useState<TicketThreadMessage[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ticketId) return
    let cancelled = false
    getSupportTicket(ticketId)
      .then(async (t) => {
        if (cancelled) return
        setTicket(t)
        // The thread shows the original message plus every reply in
        // chronological order, regardless of the order the API returns them.
        const fetched = await listSupportTicketReplies(ticketId).catch(() => [])
        if (cancelled) return
        setReplies(
          fetched.map((reply) => ({
            id: reply.id,
            author: reply.author === 'customer' ? 'customer' : 'support',
            body: reply.message,
            createdAt: reply.createdAt,
          })),
        )
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load ticket')
      })
    return () => {
      cancelled = true
    }
  }, [ticketId])

  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <p role="alert" className="text-destructive">
          {error}
        </p>
      </main>
    )
  }

  if (!ticket || !ticketId) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <p className="text-muted-foreground">Loading ticket…</p>
      </main>
    )
  }

  const messages: TicketThreadMessage[] = [
    {
      id: ticket.id,
      author: 'customer',
      body: ticket.message,
      createdAt: ticket.createdAt,
    },
    ...replies,
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <TicketThread
        ticketId={ticket.id}
        subject={ticket.subject}
        status={ticket.status}
        messages={messages}
      />
    </main>
  )
}
