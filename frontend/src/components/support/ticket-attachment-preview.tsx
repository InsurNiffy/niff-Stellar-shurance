'use client'

import { useEffect, useMemo, useState } from 'react'

export interface TicketAttachment {
  id: string
  url: string
  fileName: string
  contentType?: string
}

function resolveMime(attachment: TicketAttachment): string {
  if (attachment.contentType) return attachment.contentType
  const lower = attachment.fileName.toLowerCase()
  if (/\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/.test(lower)) return 'image/png'
  if (/\.pdf(\?.*)?$/.test(lower)) return 'application/pdf'
  return 'application/octet-stream'
}

function isImageMime(mime: string) {
  return mime.startsWith('image/')
}

function isPdfMime(mime: string) {
  return mime === 'application/pdf'
}

function ImagePreview({ url, fileName }: { url: string; fileName: string }) {
  return (
    <img
      src={url}
      alt={`Attachment preview: ${fileName}`}
      className="max-h-64 max-w-full rounded-md border object-contain"
      loading="lazy"
      decoding="async"
    />
  )
}

function PdfPreview({ url, fileName }: { url: string; fileName: string }) {
  return (
    <iframe
      src={url}
      title={`PDF preview: ${fileName}`}
      className="h-64 w-full rounded-md border bg-muted"
      loading="lazy"
    />
  )
}

function PreviewFallback() {
  return <p className="text-xs text-muted-foreground">Loading preview…</p>
}

function DeferredPreview({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setReady(true))
    return () => window.cancelAnimationFrame(id)
  }, [])

  if (!ready) return <PreviewFallback />
  return <>{children}</>
}

export function TicketAttachmentPreview({ attachment }: { attachment: TicketAttachment }) {
  const mime = useMemo(() => resolveMime(attachment), [attachment])

  if (!attachment?.url?.trim()) {
    return null
  }

  if (isImageMime(mime)) {
    return (
      <DeferredPreview>
        <div data-testid={`attachment-preview-image-${attachment.id}`}>
          <ImagePreview url={attachment.url} fileName={attachment.fileName} />
        </div>
      </DeferredPreview>
    )
  }

  if (isPdfMime(mime)) {
    return (
      <DeferredPreview>
        <div data-testid={`attachment-preview-pdf-${attachment.id}`}>
          <PdfPreview url={attachment.url} fileName={attachment.fileName} />
        </div>
      </DeferredPreview>
    )
  }

  return (
    <a
      href={attachment.url}
      download={attachment.fileName}
      data-testid={`attachment-download-${attachment.id}`}
      className="text-sm font-medium text-primary underline underline-offset-2"
    >
      Download {attachment.fileName}
    </a>
  )
}
