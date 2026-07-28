/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'

import { TicketAttachmentPreview } from '../ticket-attachment-preview'
import { TicketThread } from '../ticket-thread'

describe('TicketAttachmentPreview', () => {
  it('renders an inline image preview for image attachments', async () => {
    render(
      <TicketAttachmentPreview
        attachment={{
          id: 'a1',
          url: 'https://example.com/photo.png',
          fileName: 'photo.png',
          contentType: 'image/png',
        }}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('attachment-preview-image-a1')).toBeInTheDocument()
    })
    expect(screen.getByRole('img', { name: /photo\.png/i })).toHaveAttribute(
      'src',
      'https://example.com/photo.png',
    )
  })

  it('renders an inline PDF preview for PDF attachments', async () => {
    render(
      <TicketAttachmentPreview
        attachment={{
          id: 'a2',
          url: 'https://example.com/doc.pdf',
          fileName: 'doc.pdf',
        }}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('attachment-preview-pdf-a2')).toBeInTheDocument()
    })
    expect(screen.getByTitle(/doc\.pdf/i)).toHaveAttribute('src', 'https://example.com/doc.pdf')
  })

  it('falls back to a download link for unsupported file types', () => {
    render(
      <TicketAttachmentPreview
        attachment={{
          id: 'a3',
          url: 'https://example.com/archive.zip',
          fileName: 'archive.zip',
          contentType: 'application/zip',
        }}
      />,
    )

    const link = screen.getByTestId('attachment-download-a3')
    expect(link).toHaveAttribute('href', 'https://example.com/archive.zip')
    expect(link).toHaveTextContent('Download archive.zip')
  })

  it('does not crash when attachment metadata is missing', () => {
    const { container } = render(
      <TicketAttachmentPreview
        attachment={{
          id: 'a4',
          url: '',
          fileName: '',
        }}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe('TicketThread attachment rendering', () => {
  const baseProps = {
    ticketId: 't-1',
    subject: 'Help',
    status: 'open',
    messages: [],
    isTypingOverride: false as const,
  }

  it('still renders the thread while a preview is loading', () => {
    render(
      <TicketThread
        {...baseProps}
        messages={[
          {
            id: 'm1',
            author: 'customer',
            body: 'See attached',
            createdAt: '2026-01-01T00:00:00Z',
            attachments: [
              {
                id: 'slow',
                url: 'https://example.com/slow.png',
                fileName: 'slow.png',
                contentType: 'image/png',
              },
            ],
          },
        ]}
      />,
    )

    expect(screen.getByTestId('ticket-thread')).toBeInTheDocument()
    expect(screen.getByText('See attached')).toBeInTheDocument()
    expect(screen.getByText(/loading preview/i)).toBeInTheDocument()
  })
})
