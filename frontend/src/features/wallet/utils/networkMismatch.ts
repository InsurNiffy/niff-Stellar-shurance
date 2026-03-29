import type { AppNetwork } from '@/config/networkManifest'

import { routing } from '@/i18n/routing'

/** Aligned with `ConnectionStatus` in WalletContext (kept here to avoid circular imports). */
export type WalletConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'

const READ_ONLY_EXACT = new Set(['/', '/privacy', '/support'])
const READ_ONLY_PREFIX = '/docs'

/**
 * Strips an optional next-intl locale prefix so route checks work for both
 * `/quote` (default locale) and `/es/quote`.
 */
export function stripLocalePrefix(pathname: string): string {
  const locales = routing.locales
  for (const loc of locales) {
    if (pathname === `/${loc}`) return '/'
    if (pathname.startsWith(`/${loc}/`)) {
      const rest = pathname.slice(`/${loc}`.length)
      return rest === '' ? '/' : rest
    }
  }
  return pathname
}

/**
 * Routes where we do not block the UI for wallet/app network mismatch
 * (landing, documentation, legal/support pages that do not require signing).
 */
export function isReadOnlyWalletInteractionPath(pathname: string): boolean {
  const p = stripLocalePrefix(pathname)
  if (READ_ONLY_EXACT.has(p)) return true
  if (p === READ_ONLY_PREFIX || p.startsWith(`${READ_ONLY_PREFIX}/`)) return true
  return false
}

export type WalletNetworkResolution =
  | { status: 'idle' }
  | { status: 'error' }
  | { status: 'ok'; mappedNetwork: AppNetwork | null }

/**
 * Whether the connected wallet is on a different network than the app expects.
 *
 * @param mappedNetwork — Result of {@link passphraseToAppNetwork}; `null` means
 *   the wallet reported a passphrase we do not map (custom / unknown chain).
 */
export function computeNetworkMismatch(
  connectionStatus: WalletConnectionStatus,
  appNetwork: AppNetwork,
  resolution: WalletNetworkResolution,
): boolean {
  if (connectionStatus !== 'connected') return false
  if (resolution.status !== 'ok') return false
  if (resolution.mappedNetwork === null) return true
  return resolution.mappedNetwork !== appNetwork
}
