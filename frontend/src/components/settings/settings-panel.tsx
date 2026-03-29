'use client'

import { useState, useTransition } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, ExternalLink, RefreshCw, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useSettings } from '@/hooks/use-settings'
import { useWallet } from '@/hooks/use-wallet'
import { SETTINGS_NETWORK_SECTION_ID } from '@/features/wallet/constants'
import { getContracts } from '@/lib/network-manifest'
import { validateRpcUrl, PUBLIC_RPC, STATUS_PAGES, type AppSettings } from '@/lib/settings-store'
import type { Network } from '@/lib/network-manifest'

const NETWORKS: Network[] = ['testnet', 'public']

export function SettingsPanel() {
  const { settings, update, reset } = useSettings()
  const { disconnect, setAppNetwork } = useWallet()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [rpcInput, setRpcInput] = useState(settings.customRpcUrl ?? '')
  const [rpcError, setRpcError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleNetworkChange(network: Network) {
    update('network', network)
    setAppNetwork(network === 'public' ? 'mainnet' : 'testnet')
    // Pull fresh contract manifests for the new network
    startTransition(() => {
      getContracts(network) // re-reads registry; triggers any dependent queries
    })
  }

  function handleRpcSave() {
    if (!rpcInput.trim()) {
      update('customRpcUrl', null)
      update('rpcWarningAcknowledged', false)
      setRpcError(null)
      return
    }
    const err = validateRpcUrl(rpcInput)
    if (err) { setRpcError(err); return }
    setRpcError(null)
    update('customRpcUrl', rpcInput.trim())
  }

  function handleClearCaches() {
    // Clear React Query cache key prefix used by the app
    if (typeof window !== 'undefined') {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('rq-') || k.startsWith('sim-'))
        .forEach((k) => localStorage.removeItem(k))
    }
    window.location.reload()
  }

  const activeRpc = settings.customRpcUrl ?? PUBLIC_RPC[settings.network]
  const isCustomRpc = !!settings.customRpcUrl

  return (
    <div className="space-y-6 max-w-xl">
      {/* Network */}
      <Card id={SETTINGS_NETWORK_SECTION_ID} tabIndex={-1}>
        <CardHeader>
          <CardTitle>Network</CardTitle>
          <CardDescription>
            Switch between Stellar Testnet and Mainnet. Contract manifests reload automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            {NETWORKS.map((n) => (
              <Button
                key={n}
                variant={settings.network === n ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleNetworkChange(n)}
                disabled={isPending}
                aria-pressed={settings.network === n}
              >
                {n === 'public' ? 'Mainnet' : 'Testnet'}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Active RPC:{' '}
            <span className="font-mono">{activeRpc}</span>
            {!isCustomRpc && (
              <span className="ml-2 text-yellow-600 dark:text-yellow-400">
                (public endpoint — rate limits apply)
              </span>
            )}
          </p>
          <a
            href={STATUS_PAGES[settings.network]}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
          >
            Stellar infrastructure status <ExternalLink className="h-3 w-3" />
          </a>
        </CardContent>
      </Card>

      {/* Advanced — behind disclosure */}
      <Card>
        <CardHeader>
          <button
            className="flex w-full items-center justify-between text-left"
            onClick={() => setAdvancedOpen((o) => !o)}
            aria-expanded={advancedOpen}
          >
            <div>
              <CardTitle>Advanced</CardTitle>
              <CardDescription>Custom RPC, cache management, wallet reset</CardDescription>
            </div>
            {advancedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </CardHeader>

        {advancedOpen && (
          <CardContent className="space-y-6">
            {/* Custom RPC */}
            <section aria-labelledby="rpc-heading" className="space-y-3">
              <h3 id="rpc-heading" className="text-sm font-semibold">Custom Soroban RPC URL</h3>

              {/* Phishing warning — always visible when section is open */}
              <div
                role="alert"
                className="flex gap-2 rounded-md border border-yellow-400 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-600 dark:bg-yellow-950 dark:text-yellow-200"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <strong>Security warning:</strong> A malicious RPC endpoint can misrepresent
                  balances, events, and transaction outcomes. Only use endpoints you fully trust.
                  Never enter a URL from an unsolicited message or link.
                </div>
              </div>

              <div className="flex gap-2">
                <Input
                  aria-label="Custom RPC URL"
                  placeholder={PUBLIC_RPC[settings.network]}
                  value={rpcInput}
                  onChange={(e) => setRpcInput(e.target.value)}
                  className={rpcError ? 'border-destructive' : ''}
                />
                <Button variant="outline" size="sm" onClick={handleRpcSave}>
                  Save
                </Button>
              </div>
              {rpcError && <p className="text-xs text-destructive">{rpcError}</p>}
              {isCustomRpc && (
                <p className="text-xs text-muted-foreground">
                  Leave blank and save to revert to the public endpoint.
                </p>
              )}

              {/* Acknowledgement checkbox — required before custom RPC takes effect */}
              {isCustomRpc && !settings.rpcWarningAcknowledged && (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={settings.rpcWarningAcknowledged}
                    onChange={(e) => update('rpcWarningAcknowledged', e.target.checked)}
                  />
                  I understand that a custom RPC can misrepresent on-chain data and I trust this
                  endpoint.
                </label>
              )}
            </section>

            {/* Cache management */}
            <section aria-labelledby="cache-heading" className="space-y-2">
              <h3 id="cache-heading" className="text-sm font-semibold">Cache</h3>
              <p className="text-xs text-muted-foreground">
                Clears cached simulations and React Query data, then reloads the page.
              </p>
              <Button variant="outline" size="sm" onClick={handleClearCaches}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Clear caches &amp; refetch
              </Button>
            </section>

            {/* Wallet reset */}
            <section aria-labelledby="wallet-heading" className="space-y-2">
              <h3 id="wallet-heading" className="text-sm font-semibold">Wallet connection</h3>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => { disconnect(); reset() }}
              >
                <Unplug className="mr-2 h-4 w-4" />
                Disconnect &amp; reset settings
              </Button>
            </section>

            {/* Telemetry */}
            <section aria-labelledby="telemetry-heading" className="space-y-2">
              <h3 id="telemetry-heading" className="text-sm font-semibold">Telemetry</h3>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={settings.telemetryEnabled}
                  onChange={(e) => update('telemetryEnabled', e.target.checked)}
                />
                <span>
                  Send anonymous settings-change events to help improve the app.{' '}
                  <span className="text-muted-foreground">
                    No wallet addresses, balances, or personal data are ever included.
                  </span>
                </span>
              </label>
            </section>
          </CardContent>
        )}
      </Card>
    </div>
  )
}
