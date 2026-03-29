'use client'

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { StellarWalletsKit, Networks, KitEventType } from '@creit.tech/stellar-wallets-kit'
import { FreighterModule, FREIGHTER_ID } from '@creit.tech/stellar-wallets-kit/modules/freighter'
import { xBullModule, XBULL_ID } from '@creit.tech/stellar-wallets-kit/modules/xbull'
import type { AppNetwork } from '@/config/networkManifest'
import { passphraseToAppNetwork } from '@/config/networkManifest'
import { toast } from '@/components/ui/use-toast'
import {
  computeNetworkMismatch,
  type WalletNetworkResolution,
} from '@/features/wallet/utils/networkMismatch'

export type WalletId = typeof FREIGHTER_ID | typeof XBULL_ID
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface WalletContextValue {
  address: string | null
  connectionStatus: ConnectionStatus
  activeWalletId: WalletId | null
  /** The network the wallet is currently on (null = unknown / not connected) */
  walletNetwork: AppNetwork | null
  /** The network the app is configured to use */
  appNetwork: AppNetwork
  /** True when wallet network ≠ app network (or wallet uses an unmapped passphrase) */
  networkMismatch: boolean
  /**
   * Last wallet `getNetwork()` outcome: `ok` + mapped passphrase (or null if unknown),
   * `idle` before connect / after disconnect, `error` if getNetwork threw.
   */
  walletNetworkResolution: WalletNetworkResolution
  connect: (walletId: WalletId) => Promise<void>
  disconnect: () => Promise<void>
  signTransaction: (xdr: string) => Promise<string>
  setAppNetwork: (network: AppNetwork) => void
}

const WalletContext = createContext<WalletContextValue | null>(null)

const LS_WALLET_KEY = 'niffyinsure:lastWalletId'
const LS_NETWORK_KEY = 'niffyinsure:appNetwork'

function kitNetworkFor(app: AppNetwork): Networks {
  if (app === 'mainnet') return Networks.PUBLIC
  if (app === 'futurenet') return Networks.FUTURENET
  return Networks.TESTNET
}

function initKit(appNetwork: AppNetwork) {
  StellarWalletsKit.init({
    network: kitNetworkFor(appNetwork),
    modules: [new FreighterModule(), new xBullModule()],
  })
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected')
  const [activeWalletId, setActiveWalletId] = useState<WalletId | null>(null)
  const [walletNetwork, setWalletNetwork] = useState<AppNetwork | null>(null)
  const [walletNetworkResolution, setWalletNetworkResolution] =
    useState<WalletNetworkResolution>({ status: 'idle' })
  const [appNetwork, setAppNetworkState] = useState<AppNetwork>(() => {
    if (typeof window === 'undefined') return 'testnet'
    return (localStorage.getItem(LS_NETWORK_KEY) as AppNetwork) ?? 'testnet'
  })

  const kitInitialized = useRef(false)

  // Initialize kit once on mount
  useEffect(() => {
    if (kitInitialized.current) return
    kitInitialized.current = true
    initKit(appNetwork)

    // Listen for state updates from the kit (address changes, wallet switches)
    StellarWalletsKit.on(KitEventType.STATE_UPDATED, async () => {
      try {
        const { address: addr } = await StellarWalletsKit.getAddress()
        setAddress(addr ?? null)
        if (addr) {
          setConnectionStatus('connected')
          await refreshWalletNetwork()
        } else {
          setConnectionStatus('disconnected')
          setActiveWalletId(null)
          setWalletNetwork(null)
          setWalletNetworkResolution({ status: 'idle' })
        }
      } catch {
        setAddress(null)
      }
    })

    StellarWalletsKit.on(KitEventType.DISCONNECT, () => {
      setAddress(null)
      setConnectionStatus('disconnected')
      setActiveWalletId(null)
      setWalletNetwork(null)
      setWalletNetworkResolution({ status: 'idle' })
    })

    // Auto-reconnect last wallet
    const lastWallet = localStorage.getItem(LS_WALLET_KEY) as WalletId | null
    if (lastWallet) {
      reconnect(lastWallet)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function reconnect(walletId: WalletId) {
    try {
      StellarWalletsKit.setWallet(walletId)
      const { address: addr } = await StellarWalletsKit.getAddress()
      if (addr) {
        setAddress(addr)
        setActiveWalletId(walletId)
        setConnectionStatus('connected')
        await refreshWalletNetwork()
      }
    } catch {
      // Silent — wallet may not be unlocked yet
    }
  }

  async function refreshWalletNetwork() {
    try {
      const { network } = await StellarWalletsKit.getNetwork()
      const appNet = passphraseToAppNetwork(network)
      setWalletNetwork(appNet)
      setWalletNetworkResolution({ status: 'ok', mappedNetwork: appNet })
    } catch {
      setWalletNetwork(null)
      setWalletNetworkResolution({ status: 'error' })
    }
  }

  const connect = useCallback(async (walletId: WalletId) => {
    setConnectionStatus('connecting')
    try {
      StellarWalletsKit.setWallet(walletId)
      const { address: addr } = await StellarWalletsKit.getAddress()
      setAddress(addr ?? null)
      setActiveWalletId(walletId)
      setConnectionStatus('connected')
      localStorage.setItem(LS_WALLET_KEY, walletId)
      await refreshWalletNetwork()
    } catch (err: unknown) {
      setWalletNetworkResolution({ status: 'idle' })
      setConnectionStatus('error')
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('cancel')) {
        toast({ title: 'Transaction Cancelled', description: 'You rejected the request in your wallet.', variant: 'destructive' })
      } else {
        toast({ title: 'Connection failed', description: msg, variant: 'destructive' })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const disconnect = useCallback(async () => {
    await StellarWalletsKit.disconnect()
    setAddress(null)
    setConnectionStatus('disconnected')
    setActiveWalletId(null)
    setWalletNetwork(null)
    setWalletNetworkResolution({ status: 'idle' })
    localStorage.removeItem(LS_WALLET_KEY)
  }, [])

  const signTransaction = useCallback(async (xdr: string): Promise<string> => {
    await refreshWalletNetwork()
    try {
      const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr)
      await refreshWalletNetwork()
      return signedTxXdr
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('cancel')) {
        toast({ title: 'Transaction Cancelled', description: 'You rejected the transaction in your wallet.', variant: 'destructive' })
      }
      throw err
    }
  }, [])

  const setAppNetwork = useCallback((network: AppNetwork) => {
    setAppNetworkState(network)
    localStorage.setItem(LS_NETWORK_KEY, network)
    StellarWalletsKit.setNetwork(kitNetworkFor(network))
    // Re-check wallet network after app network change
    if (connectionStatus === 'connected') {
      refreshWalletNetwork()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionStatus])

  const networkMismatch = computeNetworkMismatch(
    connectionStatus,
    appNetwork,
    walletNetworkResolution,
  )

  return (
    <WalletContext.Provider
      value={{
        address,
        connectionStatus,
        activeWalletId,
        walletNetwork,
        appNetwork,
        networkMismatch,
        walletNetworkResolution,
        connect,
        disconnect,
        signTransaction,
        setAppNetwork,
      }}
    >
      {children}
    </WalletContext.Provider>
  )
}

export function useWalletContext(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWalletContext must be used inside <WalletProvider>')
  return ctx
}
