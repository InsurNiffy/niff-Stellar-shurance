'use client'

import { useState } from 'react'
import { Copy, Check, Wallet, ChevronDown, AlertTriangle } from 'lucide-react'
import { FREIGHTER_ID } from '@creit.tech/stellar-wallets-kit/modules/freighter'
import { XBULL_ID } from '@creit.tech/stellar-wallets-kit/modules/xbull'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useWallet } from '../hooks/useWallet'
import { truncateAddress } from '../utils/truncateAddress'
import type { WalletId } from '../context/WalletContext'

const WALLETS: { id: WalletId; label: string; chromeUrl: string; firefoxUrl: string }[] = [
  {
    id: FREIGHTER_ID as WalletId,
    label: 'Freighter',
    chromeUrl: 'https://chrome.google.com/webstore/detail/freighter/bcacfldlkkdogcmkkibnjlakofdplcbk',
    firefoxUrl: 'https://addons.mozilla.org/en-US/firefox/addon/freighter/',
  },
  {
    id: XBULL_ID as WalletId,
    label: 'xBull',
    chromeUrl: 'https://chrome.google.com/webstore/detail/xbull-wallet/omajpeaffjgmlpmhbfdjepdejoemifpe',
    firefoxUrl: 'https://addons.mozilla.org/en-US/firefox/addon/xbull-wallet/',
  },
]

export function WalletConnectButton() {
  const { address, connectionStatus, activeWalletId, connect, disconnect } = useWallet()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const isConnected = connectionStatus === 'connected' && address
  const isConnecting = connectionStatus === 'connecting'

  async function handleCopy() {
    if (!address) return
    await navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleConnect(walletId: WalletId) {
    setOpen(false)
    await connect(walletId)
  }

  if (isConnected) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={handleCopy}
          title="Click to copy address"
          className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono hover:bg-accent transition-colors"
          aria-label={`Copy wallet address: ${truncateAddress(address)}`}
        >
          {truncateAddress(address)}
          {copied ? <Check className="h-3.5 w-3.5 text-green-500" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
        </button>
        <Button variant="outline" size="sm" onClick={disconnect} aria-label="Disconnect wallet">
          Disconnect
        </Button>
      </div>
    )
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        disabled={isConnecting}
        size="sm"
        className="gap-2"
      >
        <Wallet className="h-4 w-4" />
        {isConnecting ? 'Connecting…' : 'Connect Wallet'}
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm" aria-labelledby="wallet-connect-title" aria-describedby="wallet-connect-desc">
          <DialogHeader>
            <DialogTitle id="wallet-connect-title">Connect Wallet</DialogTitle>
            <DialogDescription id="wallet-connect-desc">
              Choose a wallet to connect to NiffyInsur.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {WALLETS.map((w) => (
              <div key={w.id} className="flex flex-col gap-1">
                <Button
                  variant="outline"
                  className="w-full justify-start gap-3"
                  onClick={() => handleConnect(w.id)}
                >
                  <Wallet className="h-4 w-4" />
                  {w.label}
                </Button>
                <p className="text-xs text-muted-foreground px-1">
                  Not installed?{' '}
                  <a href={w.chromeUrl} target="_blank" rel="noopener noreferrer" className="underline">Chrome</a>
                  {' / '}
                  <a href={w.firefoxUrl} target="_blank" rel="noopener noreferrer" className="underline">Firefox</a>
                </p>
              </div>
            ))}
          </div>

          {/* Anti-phishing / self-custody disclaimer */}
          <div className="mt-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-700 dark:text-yellow-400 flex gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <strong>Self-custody:</strong> NiffyInsur never asks for your seed phrase or private key.
              Always verify you are on <strong>niffyinsur.com</strong> before connecting.
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
