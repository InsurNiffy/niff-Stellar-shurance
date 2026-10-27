'use client';

import { ExternalLink, MessageCircle, BookOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { ContactForm } from "@/components/support/contact-form";
import { FaqAccordion } from "@/components/support/faq-accordion";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { FAQ_ITEMS } from "@/lib/faq-data";
import { listFaqItems, listMySupportTickets, type SupportTicketView } from "@/lib/api/support";
import { useAuth } from "@/lib/hooks/useAuth";

export default function SupportPage() {
  const { jwt, isAuthenticated } = useAuth();
  const [faqs, setFaqs] = useState(FAQ_ITEMS);
  const [faqError, setFaqError] = useState<string | null>(null);
  const [tickets, setTickets] = useState<SupportTicketView[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [ticketRefresh, setTicketRefresh] = useState(0);

  useEffect(() => {
    listFaqItems()
      .then((items) => setFaqs(items.map((item) => ({ id: item.id, question: item.question, answer: item.answer }))))
      .catch((error: unknown) => setFaqError(error instanceof Error ? error.message : "Failed to load FAQs"));
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !jwt) {
      setTickets([]);
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }

    let cancelled = false;
    setTickets([]);
    setHistoryLoading(true);
    setHistoryError(null);
    listMySupportTickets(jwt)
      .then((result) => {
        if (!cancelled) setTickets(result.tickets);
      })
      .catch((error: unknown) => {
        if (!cancelled) setHistoryError(error instanceof Error ? error.message : "Failed to load ticket history");
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, jwt, ticketRefresh]);

  return (
    <main data-tour="support" className="mx-auto max-w-3xl px-4 py-16 space-y-16">
      {/* Header */}
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Support Center</h1>
        <p className="text-muted-foreground">
          Find answers to common questions or reach out to our team.
        </p>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <a
          href="https://discord.gg/niffyinsur"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-lg border p-4 hover:bg-muted/50 transition-colors"
        >
          <MessageCircle className="h-5 w-5 text-primary shrink-0" />
          <div>
            <p className="font-medium text-sm">Discord Community</p>
            <p className="text-xs text-muted-foreground">
              Chat with the community
            </p>
          </div>
          <ExternalLink className="ml-auto h-4 w-4 text-muted-foreground" />
        </a>
        <a
          href="https://docs.niffyinsur.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-lg border p-4 hover:bg-muted/50 transition-colors"
        >
          <BookOpen className="h-5 w-5 text-primary shrink-0" />
          <div>
            <p className="font-medium text-sm">Documentation</p>
            <p className="text-xs text-muted-foreground">
              Guides and API reference
            </p>
          </div>
          <ExternalLink className="ml-auto h-4 w-4 text-muted-foreground" />
        </a>
      </div>

      {/* FAQ */}
      <section aria-labelledby="faq-heading">
        <h2 id="faq-heading" className="text-xl font-semibold mb-4">
          Frequently Asked Questions
        </h2>
        {faqError && <p role="alert" className="mb-3 text-sm text-destructive">{faqError} Showing saved FAQs instead.</p>}
        <FaqAccordion items={faqs} />
      </section>

      {isAuthenticated && (
        <section aria-labelledby="ticket-history-heading">
          <h2 id="ticket-history-heading" className="text-xl font-semibold mb-4">Your tickets</h2>
          {historyError ? (
            <p role="alert" className="text-sm text-destructive">{historyError}</p>
          ) : historyLoading ? (
            <p role="status" className="text-sm text-muted-foreground">Loading your tickets…</p>
          ) : tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">You have not submitted any tickets.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {tickets.map((ticket) => (
                <li key={ticket.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <a href={`/support/tickets/${ticket.id}`} className="font-medium hover:underline">{ticket.subject}</a>
                    <p className="text-xs text-muted-foreground">{new Date(ticket.createdAt).toLocaleString()}</p>
                  </div>
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">{ticket.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Contact form */}
      <section aria-labelledby="contact-heading">
        <Card>
          <CardHeader>
            <CardTitle id="contact-heading">Contact Support</CardTitle>
            <CardDescription>
              Can&apos;t find what you need? Send us a message and we&apos;ll respond within 1–2 business days.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ContactForm onSubmitted={() => setTicketRefresh((current) => current + 1)} />
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
