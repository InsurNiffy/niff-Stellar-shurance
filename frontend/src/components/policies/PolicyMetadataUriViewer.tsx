'use client'

import { AlertTriangle, ExternalLink, FileText, Hash } from 'lucide-react'
import { getConfig } from '@/config/env'

interface PolicyMetadataUriViewerProps {
  metadataUri: string
  termsHash?: string | null
}

/**
 * Resolves an IPFS URI to an HTTP gateway URL.
 * Falls back to the raw URI if it does not start with ipfs://
 */
function resolveIpfsUri(uri: string): string {
  const { ipfsGateway } = getConfig()

  if (uri.startsWith('ipfs://')) {
    const cid = uri.slice('ipfs://'.length)
    // Strip leading slash if present
    const cleanCid = cid.startsWith('/') ? cid.slice(1) : cid
    return `${ipfsGateway}/${cleanCid}`
  }

  // Not an IPFS URI — return as-is
  return uri
}

/**
 * Checks whether the URI scheme is IPFS (ipfs://).
 */
function isIpfsScheme(uri: string): boolean {
  return uri.startsWith('ipfs://')
}

export function PolicyMetadataUriViewer({
  metadataUri,
  termsHash,
}: PolicyMetadataUriViewerProps) {
  if (!metadataUri) {
    return null
  }

  const resolvedUrl = resolveIpfsUri(metadataUri)
  const isIpfs = isIpfsScheme(metadataUri)
  const displayUri = metadataUri.length > 80
    ? `${metadataUri.slice(0, 77)}...`
    : metadataUri

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <FileText className="h-4 w-4" aria-hidden="true" />
        <span>Policy Document</span>
      </div>

      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <ExternalLink className="h-4 w-4 mt-0.5 text-gray-400 flex-shrink-0" aria-hidden="true" />
          <a
            href={resolvedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:text-blue-800 hover:underline break-all"
            title={metadataUri}
          >
            {displayUri}
          </a>
        </div>

        {termsHash && (
          <div className="flex items-start gap-2">
            <Hash className="h-4 w-4 mt-0.5 text-gray-400 flex-shrink-0" aria-hidden="true" />
            <div className="space-y-1 min-w-0">
              <p className="text-xs font-medium text-gray-600">
                Terms Hash (SHA-256){' '}
                <a
                  href={resolvedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 hover:underline"
                  aria-label="view document"
                  title={`Verify SHA-256 hash against: ${metadataUri}`}
                >
                  (view document)
                </a>
              </p>
              <code
                className="block text-xs bg-gray-100 px-2 py-1 rounded break-all font-mono"
                aria-label="Terms hash"
              >
                {termsHash}
              </code>
            </div>
          </div>
        )}

        {!isIpfs && (
          <div
            className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs"
            role="alert"
          >
            <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span>
              Warning: This document is not hosted on IPFS. The URI scheme is not{' '}
              <code className="font-mono text-xs bg-amber-100 px-1 rounded">ipfs://</code>.
              Verify the document integrity using the terms hash above.
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
