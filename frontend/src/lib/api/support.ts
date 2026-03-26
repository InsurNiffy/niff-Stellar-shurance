const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export interface TicketPayload {
  email: string;
  subject: string;
  message: string;
  captchaToken: string;
}

export async function submitSupportTicket(payload: TicketPayload): Promise<{ id: string; status: string }> {
  const res = await fetch(`${API_BASE_URL}/api/support/tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to submit ticket');
  }

  return res.json();
}

export async function trackFaqExpansion(faqId: string): Promise<void> {
  // Fire-and-forget — don't block the UI
  fetch(`${API_BASE_URL}/api/support/faq/${faqId}/expand`, { method: 'POST' }).catch(() => {});
}
