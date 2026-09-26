'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

import { TicketThread } from '@/components/support/ticket-thread'
import { getSupportTicket, type SupportTicketView } from '@/lib/api/support'

export default function SupportTicketPage() {
  const params = useParams<{ id: string }>()
  const ticketId = params?.id
  const [ticket, setTicket] = useState<SupportTicketView | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ticketId) return
    let cancelled = false
    getSupportTicket(ticketId)
      .then((t) => {
        if (!cancelled) setTicket(t)
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

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <TicketThread
        ticketId={ticket.id}
        subject={ticket.subject}
        status={ticket.status}
        messages={[
          {
            id: 'initial',
            author: 'customer',
            body: ticket.message,
            createdAt: ticket.createdAt,
          },
        ]}
      />
    </main>
  )
}
