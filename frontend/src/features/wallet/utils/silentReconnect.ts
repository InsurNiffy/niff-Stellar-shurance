import { FreighterModule } from '@creit.tech/stellar-wallets-kit/modules/freighter'
import { xBullModule } from '@creit.tech/stellar-wallets-kit/modules/xbull'
import { LobstrModule } from '@creit.tech/stellar-wallets-kit/modules/lobstr'
import { FREIGHTER_ID } from '@creit.tech/stellar-wallets-kit/modules/freighter'
import { XBULL_ID } from '@creit.tech/stellar-wallets-kit/modules/xbull'
import { LOBSTR_ID } from '@creit.tech/stellar-wallets-kit/modules/lobstr'
import type { WalletId } from '../context/WalletContext'

function moduleForWallet(walletId: WalletId): { isAvailable(): Promise<boolean> } | null {
  switch (walletId) {
    case FREIGHTER_ID as WalletId:
      return new FreighterModule()
    case XBULL_ID as WalletId:
      return new xBullModule()
    case LOBSTR_ID as WalletId:
      return new LobstrModule()
    default:
      return null
  }
}

/** True when the wallet extension is present and can answer getAddress without a connect prompt. */
export async function walletSupportsSilentReconnect(walletId: WalletId): Promise<boolean> {
  const mod = moduleForWallet(walletId)
  if (!mod) return false
  try {
    return await mod.isAvailable()
  } catch {
    return false
  }
}
