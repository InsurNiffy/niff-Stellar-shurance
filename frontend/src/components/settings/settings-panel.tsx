'use client'

import { useState, useTransition } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, ExternalLink, Moon, RefreshCw, Sun, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTheme } from '@/components/theme-provider'
import { useSettings, useNotificationSync } from '@/hooks/use-settings'
import { useWallet } from '@/hooks/use-wallet'
import { useAuth } from '@/lib/hooks/useAuth'
import { SETTINGS_NETWORK_SECTION_ID } from '@/features/wallet/constants'
import { getContracts } from '@/lib/network-manifest'
import { validateRpcUrl, PUBLIC_RPC, STATUS_PAGES, type AppSettings } from '@/lib/settings-store'
import type { Network } from '@/lib/network-manifest'

const NETWORKS: Network[] = ['testnet', 'public']
const CURRENCIES: AppSettings['displayCurrency'][] = ['XLM', 'USD', 'EUR']

export function SettingsPanel() {
  const { settings, update, reset } = useSettings()
  const { disconnect, setAppNetwork, address } = useWallet()
  const { jwt } = useAuth()
  const { theme, setTheme } = useTheme()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [rpcInput, setRpcInput] = useState(settings.customRpcUrl ?? '')
  const [rpcError, setRpcError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const { syncing, syncError } = useNotificationSync(
    settings.notifications,
    address ?? null,
    jwt,
  )

  function handleNetworkChange(network: Network) {
    update('network', network)
    setAppNetwork(network === 'public' ? 'mainnet' : 'testnet')
    startTransition(() => {
      getContracts(network)
    })
  }

  function handleNotificationToggle(key: keyof AppSettings['notifications'], value: boolean) {
    update('notifications', { ...settings.notifications, [key]: value })
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

      {/* ── Theme ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Choose your preferred colour scheme.</CardDescription>
        </CardHeader>
        <CardContent>
          <div role="group" aria-label="Theme" className="flex gap-2">
            {(['light', 'dark', 'system'] as const).map((t) => (
              <Button
                key={t}
                variant={theme === t ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTheme(t)}
                aria-pressed={theme === t}
                className="gap-2 capitalize"
              >
                {t === 'light' && <Sun className="h-4 w-4" aria-hidden="true" />}
                {t === 'dark' && <Moon className="h-4 w-4" aria-hidden="true" />}
                {t}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Display currency ──────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Display currency</CardTitle>
          <CardDescription>Amounts are shown in this currency where conversion is available.</CardDescription>
        </CardHeader>
        <CardContent>
          <div role="group" aria-label="Display currency" className="flex gap-2">
            {CURRENCIES.map((c) => (
              <Button
                key={c}
                variant={settings.displayCurrency === c ? 'default' : 'outline'}
                size="sm"
                onClick={() => update('displayCurrency', c)}
                aria-pressed={settings.displayCurrency === c}
              >
                {c}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Notification preferences ──────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>
            Control which events trigger email and browser notifications.
            {!address && (
              <span className="block mt-1 text-xs text-muted-foreground">
                Connect your wallet to sync preferences with the backend.
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <NotificationToggle
            id="renewal-reminders"
            label="Policy renewal reminders"
            description="Get notified before your policy expires."
            checked={settings.notifications.renewalRemindersEnabled}
            onChange={(v) => handleNotificationToggle('renewalRemindersEnabled', v)}
          />
          <NotificationToggle
            id="claim-updates"
            label="Claim status updates"
            description="Get notified when a claim you filed changes status."
            checked={settings.notifications.claimUpdatesEnabled}
            onChange={(v) => handleNotificationToggle('claimUpdatesEnabled', v)}
          />
          {syncing && (
            <p className="text-xs text-muted-foreground" aria-live="polite">Syncing preferences…</p>
          )}
          {syncError && (
            <p className="text-xs text-destructive" role="alert">
              Failed to sync: {syncError}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Network ───────────────────────────────────────────────────── */}
      <Card id={SETTINGS_NETWORK_SECTION_ID} tabIndex={-1}>
        <CardHeader>
          <CardTitle>Network</CardTitle>
          <CardDescription>
            Switch between Stellar Testnet and Mainnet. Contract manifests reload automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div role="group" aria-label="Network" className="flex gap-2">
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
            Active RPC: <span className="font-mono">{activeRpc}</span>
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
            Stellar infrastructure status <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </CardContent>
      </Card>

      {/* ── Advanced ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <button
            className="flex w-full items-center justify-between text-left"
            onClick={() => setAdvancedOpen((o) => !o)}
            aria-expanded={advancedOpen}
            aria-controls="advanced-section"
          >
            <div>
              <CardTitle>Advanced</CardTitle>
              <CardDescription>Custom RPC, cache management, wallet reset</CardDescription>
            </div>
            {advancedOpen
              ? <ChevronUp className="h-4 w-4" aria-hidden="true" />
              : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
          </button>
        </CardHeader>

        {advancedOpen && (
          <CardContent id="advanced-section" className="space-y-6">
            {/* Custom RPC */}
            <section aria-labelledby="rpc-heading" className="space-y-3">
              <h3 id="rpc-heading" className="text-sm font-semibold">Custom Soroban RPC URL</h3>
              <div
                role="alert"
                className="flex gap-2 rounded-md border border-yellow-400 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-600 dark:bg-yellow-950 dark:text-yellow-200"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div>
                  <strong>Security warning:</strong> A malicious RPC endpoint can misrepresent
                  balances, events, and transaction outcomes. Only use endpoints you fully trust.
                </div>
              </div>
              <div className="flex gap-2">
                <Input
                  aria-label="Custom RPC URL"
                  placeholder={PUBLIC_RPC[settings.network]}
                  value={rpcInput}
                  onChange={(e) => setRpcInput(e.target.value)}
                  className={rpcError ? 'border-destructive' : ''}
                  aria-describedby={rpcError ? 'rpc-error' : undefined}
                  aria-invalid={!!rpcError}
                />
                <Button variant="outline" size="sm" onClick={handleRpcSave}>Save</Button>
              </div>
              {rpcError && <p id="rpc-error" className="text-xs text-destructive" role="alert">{rpcError}</p>}
              {isCustomRpc && !settings.rpcWarningAcknowledged && (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={settings.rpcWarningAcknowledged}
                    onChange={(e) => update('rpcWarningAcknowledged', e.target.checked)}
                  />
                  I understand that a custom RPC can misrepresent on-chain data and I trust this endpoint.
                </label>
              )}
            </section>

            {/* Cache */}
            <section aria-labelledby="cache-heading" className="space-y-2">
              <h3 id="cache-heading" className="text-sm font-semibold">Cache</h3>
              <p className="text-xs text-muted-foreground">
                Clears cached simulations and React Query data, then reloads the page.
              </p>
              <Button variant="outline" size="sm" onClick={handleClearCaches}>
                <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                Clear caches &amp; refetch
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
                  <span className="text-muted-foreground">No wallet addresses or personal data included.</span>
                </span>
              </label>
            </section>

            {/* Wallet reset */}
            <section aria-labelledby="wallet-heading" className="space-y-2">
              <h3 id="wallet-heading" className="text-sm font-semibold">Wallet connection</h3>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => { disconnect(); reset() }}
              >
                <Unplug className="mr-2 h-4 w-4" aria-hidden="true" />
                Disconnect &amp; reset settings
              </Button>
            </section>
          </CardContent>
        )}
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reusable toggle row
// ---------------------------------------------------------------------------

interface NotificationToggleProps {
  id: string
  label: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
}

function NotificationToggle({ id, label, description, checked, onChange }: NotificationToggleProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-sm font-medium cursor-pointer">{label}</Label>
        <p id={`${id}-desc`} className="text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        aria-describedby={`${id}-desc`}
        onClick={() => onChange(!checked)}
        className={[
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
          'transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          checked ? 'bg-primary' : 'bg-input',
        ].join(' ')}
      >
        <span className="sr-only">{label}</span>
        <span
          aria-hidden="true"
          className={[
            'pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg',
            'ring-0 transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0',
          ].join(' ')}
        />
      </button>
    </div>
  )
}
