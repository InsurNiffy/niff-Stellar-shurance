'use client'

import { useState } from 'react'
import { Copy, Check, ExternalLink } from 'lucide-react'
import { truncateAddress } from '../utils/truncateAddress'
import { stellarExpertAccountUrl } from '../utils/stellarExpert'
import type { AppNetwork } from '@/config/networkManifest'

export interface WalletAddressProps {
  address: string
  network?: AppNetwork
  showCopy?: boolean
  showExplorer?: boolean
  className?: string
}

/**
 * Displays a Stellar address truncated to GXXXX...XXXX format.
 * - Tooltip shows the full address on hover.
 * - Optional copy button writes to clipboard and shows "Copied!" feedback for 2 s.
 * - Optional explorer link opens Stellar Expert for the configured network.
 */
export function WalletAddress({
  address,
  network = 'testnet',
  showCopy = true,
  showExplorer = false,
  className = '',
}: WalletAddressProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard API unavailable (non-secure context) — silently ignore
    }
  }

  const truncated = truncateAddress(address, 4)
  const explorerUrl = stellarExpertAccountUrl(address, network)

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span
        title={address}
        className="font-mono text-sm cursor-default"
        aria-label={`Wallet address: ${address}`}
      >
        {truncated}
      </span>

      {showCopy && (
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? 'Copied!' : 'Copy address'}
          title={copied ? 'Copied!' : 'Copy address'}
          className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-500" aria-hidden />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
      )}

      {showExplorer && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View on Stellar Expert"
          title="View on Stellar Expert"
          className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      )}
    </span>
  )
}
