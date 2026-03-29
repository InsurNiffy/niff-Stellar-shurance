'use client'

import { useEffect, useId, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { AppNetwork } from '@/config/networkManifest'
import { useWallet } from '../hooks/useWallet'
import { Link, usePathname } from '@/i18n/navigation'
import {
  isReadOnlyWalletInteractionPath,
  type WalletNetworkResolution,
} from '@/features/wallet/utils/networkMismatch'
import { SETTINGS_NETWORK_SECTION_ID } from '@/features/wallet/constants'

const NETWORK_LABELS: Record<AppNetwork, string> = {
  testnet: 'Testnet',
  mainnet: 'Mainnet',
  futurenet: 'Futurenet',
}

export function buildMismatchCopy(
  appNetwork: AppNetwork,
  resolution: WalletNetworkResolution,
): { title: string; body: string; announcement: string } {
  const appLabel = NETWORK_LABELS[appNetwork]
  if (resolution.status === 'ok' && resolution.mappedNetwork === null) {
    return {
      title: 'Unsupported wallet network',
      body: `This app only supports Stellar Testnet, Mainnet, and Futurenet. Your wallet reported a different network passphrase. Switch your wallet to ${appLabel}, or open Settings and align the app network with your wallet.`,
      announcement: `Unsupported wallet network. This app expects ${appLabel} or another supported Stellar network. Open Settings to change the app network or switch your wallet.`,
    }
  }
  const walletKey = resolution.status === 'ok' ? resolution.mappedNetwork : null
  const walletLabel = walletKey ? NETWORK_LABELS[walletKey] : 'a different network'
  return {
    title: 'Wallet network does not match this app',
    body: `This app is set to ${appLabel}, but your wallet is on ${walletLabel}. Signing would fail or submit to the wrong network. Use Switch Network to open Settings and select the same network as your wallet, or change the network in your wallet extension.`,
    announcement: `Network mismatch. The app is on ${appLabel} but the wallet is on ${walletLabel}. Open Settings to switch the app network or change your wallet network.`,
  }
}

export type NetworkMismatchOverlayViewProps = {
  open: boolean
  appNetwork: AppNetwork
  resolution: WalletNetworkResolution
  switchNetworkHref: string
}

/**
 * Presentational full-screen blocking overlay — use `NetworkMismatchModal` for wiring,
 * or this component in tests with controlled props.
 */
export function NetworkMismatchOverlayView({
  open,
  appNetwork,
  resolution,
  switchNetworkHref,
}: NetworkMismatchOverlayViewProps) {
  const titleId = useId()
  const descId = useId()
  const liveRef = useRef<HTMLDivElement>(null)
  const { title, body, announcement } = buildMismatchCopy(appNetwork, resolution)

  useEffect(() => {
    if (!open || !liveRef.current) return
    liveRef.current.textContent = announcement
  }, [open, announcement])

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        hideCloseButton
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        overlayClassName="z-[100]"
        className="z-[100] fixed inset-0 left-0 top-0 flex h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col justify-center gap-6 rounded-none border-0 bg-background/95 p-6 shadow-none backdrop-blur-sm sm:left-0 sm:top-0 sm:flex sm:max-w-none sm:translate-x-0 sm:translate-y-0 sm:rounded-none sm:pb-6"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div
          ref={liveRef}
          role="status"
          aria-live="assertive"
          aria-atomic="true"
          className="sr-only"
        />
        <DialogHeader className="mx-auto max-w-lg space-y-4 text-center sm:text-center">
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden />
            </div>
            <DialogTitle id={titleId} className="text-xl text-destructive">
              {title}
            </DialogTitle>
          </div>
          <DialogDescription id={descId} className="text-base text-foreground">
            {body}
          </DialogDescription>
        </DialogHeader>
        <div className="mx-auto flex w-full max-w-sm flex-col gap-3">
          <Button asChild size="lg" className="w-full">
            <Link href={switchNetworkHref}>Switch Network</Link>
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Settings → Network — match this to your wallet, or change the network in your wallet.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Full-screen blocking overlay when the wallet passphrase does not match the app network.
 * Skipped on read-only routes (landing, docs, privacy, support).
 */
export function NetworkMismatchModal() {
  const pathname = usePathname()
  const { networkMismatch, appNetwork, walletNetworkResolution } = useWallet()

  const blockUi = networkMismatch && !isReadOnlyWalletInteractionPath(pathname)
  const switchNetworkHref = `/settings#${SETTINGS_NETWORK_SECTION_ID}`

  return (
    <NetworkMismatchOverlayView
      open={blockUi}
      appNetwork={appNetwork}
      resolution={walletNetworkResolution}
      switchNetworkHref={switchNetworkHref}
    />
  )
}
