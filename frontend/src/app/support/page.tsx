import { Metadata } from 'next';
import { ExternalLink, MessageCircle, BookOpen } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { FaqAccordion } from '@/components/support/faq-accordion';
import { ContactForm } from '@/components/support/contact-form';
import { FAQ_ITEMS } from '@/lib/faq-data';

export const metadata: Metadata = {
  title: 'Support — NiffyInsur',
  description: 'Get help with NiffyInsur. Browse FAQs or contact our support team.',
};

export default function SupportPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 space-y-16">
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
            <p className="text-xs text-muted-foreground">Chat with the community</p>
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
            <p className="text-xs text-muted-foreground">Guides and API reference</p>
          </div>
          <ExternalLink className="ml-auto h-4 w-4 text-muted-foreground" />
        </a>
      </div>

      {/* FAQ */}
      <section aria-labelledby="faq-heading">
        <h2 id="faq-heading" className="text-xl font-semibold mb-4">Frequently Asked Questions</h2>
        <FaqAccordion items={FAQ_ITEMS} />
      </section>

      {/* Contact form */}
      <section aria-labelledby="contact-heading">
        <Card>
          <CardHeader>
            <CardTitle id="contact-heading">Contact Support</CardTitle>
            <CardDescription>
              Can't find what you need? Send us a message and we'll respond within 1–2 business days.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ContactForm />
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
