'use client'

import { useEffect, useState } from 'react'
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/hooks/useAuth'
import { useWallet } from '@/hooks/use-wallet'
import {
  getNotificationPreferences,
  patchNotificationPreferences,
  type ChannelPreferences,
  type NotificationPreferences,
} from '@/lib/api/notifications'

// Metadata must be exported from a server component, but this page is 'use client'.
// The title is set on the parent settings layout / page instead.

interface ToggleRowProps {
  id: string
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}

function ToggleRow({ id, label, description, checked, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-sm font-medium cursor-pointer">
          {label}
        </Label>
        <p id={`${id}-desc`} className="text-xs text-muted-foreground">
          {description}
        </p>
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
            'pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0',
          ].join(' ')}
        />
      </button>
    </div>
  )
}

const CHANNEL_LABELS: { key: keyof ChannelPreferences; label: string }[] = [
  { key: 'email', label: 'Email' },
  { key: 'push', label: 'Push' },
  { key: 'inApp', label: 'In-app' },
]

interface ChannelTogglesProps {
  id: string
  channels: ChannelPreferences
  disabled: boolean
  onChange: (channel: keyof ChannelPreferences, value: boolean) => void
}

function ChannelToggles({ id, channels, disabled, onChange }: ChannelTogglesProps) {
  return (
    <div className={`flex gap-4 pl-1 pt-1 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      {CHANNEL_LABELS.map(({ key, label }) => (
        <label
          key={key}
          htmlFor={`${id}-${key}`}
          className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none"
        >
          <button
            id={`${id}-${key}`}
            type="button"
            role="switch"
            aria-checked={channels[key]}
            aria-label={`${label} channel`}
            disabled={disabled}
            onClick={() => onChange(key, !channels[key])}
            className={[
              'relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border border-transparent',
              'transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
              channels[key] ? 'bg-primary' : 'bg-input',
              disabled ? 'cursor-not-allowed' : '',
            ].join(' ')}
          >
            <span
              aria-hidden="true"
              className={[
                'pointer-events-none inline-block h-3 w-3 rounded-full bg-background shadow ring-0 transition-transform',
                channels[key] ? 'translate-x-3' : 'translate-x-0',
              ].join(' ')}
            />
          </button>
          {label}
        </label>
      ))}
    </div>
  )
}

const DEFAULT_CHANNELS: ChannelPreferences = { email: true, push: true, inApp: true }

type ChannelKey = 'renewalReminders' | 'claimUpdates' | 'voteReminders'
type EnabledKey = 'renewalRemindersEnabled' | 'claimUpdatesEnabled' | 'voteRemindersEnabled'

const NOTIFICATION_TYPES: { channelKey: ChannelKey; enabledKey: EnabledKey; id: string; label: string; description: string }[] = [
  {
    channelKey: 'renewalReminders',
    enabledKey: 'renewalRemindersEnabled',
    id: 'renewal-reminders',
    label: 'Policy renewal reminders',
    description: 'Get notified before your policy expires.',
  },
  {
    channelKey: 'claimUpdates',
    enabledKey: 'claimUpdatesEnabled',
    id: 'claim-updates',
    label: 'Claim status updates',
    description: 'Get notified when a claim you filed changes status.',
  },
  {
    channelKey: 'voteReminders',
    enabledKey: 'voteRemindersEnabled',
    id: 'vote-reminders',
    label: 'Vote reminders',
    description: 'Get notified about active governance votes you haven\'t cast yet.',
  },
]

export default function NotificationsPage() {
  const { jwt } = useAuth()
  const { address } = useWallet()

  const [, setPrefs] = useState<NotificationPreferences | null>(null)
  const [draft, setDraft] = useState<NotificationPreferences | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!address || !jwt) {
      setLoading(false)
      return
    }
    setLoading(true)
    setFetchError(null)
    getNotificationPreferences(address, jwt)
      .then((p) => {
        // Backfill channels if the API doesn't return them yet
        const withChannels: NotificationPreferences = {
          ...p,
          channels: p.channels ?? {
            renewalReminders: { ...DEFAULT_CHANNELS },
            claimUpdates: { ...DEFAULT_CHANNELS },
            voteReminders: { ...DEFAULT_CHANNELS },
          },
        }
        setPrefs(withChannels)
        setDraft(withChannels)
      })
      .catch((err: unknown) => {
        setFetchError(err instanceof Error ? err.message : 'Failed to load preferences')
      })
      .finally(() => setLoading(false))
  }, [address, jwt])

  function handleToggle(key: EnabledKey, value: boolean) {
    setDraft((prev) => prev ? { ...prev, [key]: value } : prev)
    if (saveStatus === 'saved') setSaveStatus('idle')
  }

  function handleChannelToggle(
    channelKey: ChannelKey,
    enabledKey: EnabledKey,
    channel: keyof ChannelPreferences,
    value: boolean,
  ) {
    setDraft((prev) => {
      if (!prev) return prev
      const updatedChannels = {
        ...prev.channels[channelKey],
        [channel]: value,
      }
      // If all channels are off, turn off the parent type toggle
      const allOff = !updatedChannels.email && !updatedChannels.push && !updatedChannels.inApp
      return {
        ...prev,
        [enabledKey]: allOff ? false : prev[enabledKey],
        channels: {
          ...prev.channels,
          [channelKey]: updatedChannels,
        },
      }
    })
    if (saveStatus === 'saved') setSaveStatus('idle')
  }

  async function handleSave() {
    if (!address || !jwt || !draft) return
    setSaveStatus('saving')
    setSaveError(null)
    try {
      await patchNotificationPreferences(address, draft, jwt)
      setPrefs(draft)
      setSaveStatus('saved')
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save preferences')
      setSaveStatus('error')
    }
  }

  if (!address || !jwt) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="mb-6 text-2xl font-semibold">Notification Preferences</h1>
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            Connect your wallet to manage notification preferences.
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Notification Preferences</h1>

      <Card>
        <CardHeader>
          <CardTitle>Alerts</CardTitle>
          <CardDescription>
            Choose which events trigger email and browser notifications.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading preferences…
            </div>
          )}

          {fetchError && (
            <p className="flex items-center gap-1 text-sm text-destructive" role="alert">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              {fetchError}
            </p>
          )}

          {!loading && !fetchError && draft && (
            <>
              {NOTIFICATION_TYPES.map(({ channelKey, enabledKey, id, label, description }) => (
                <div key={id} className="space-y-1">
                  <ToggleRow
                    id={id}
                    label={label}
                    description={description}
                    checked={draft[enabledKey]}
                    onChange={(v) => handleToggle(enabledKey, v)}
                  />
                  <ChannelToggles
                    id={id}
                    channels={draft.channels[channelKey]}
                    disabled={!draft[enabledKey]}
                    onChange={(channel, value) =>
                      handleChannelToggle(channelKey, enabledKey, channel, value)
                    }
                  />
                </div>
              ))}

              <div className="flex items-center gap-3 pt-2">
                <Button
                  onClick={handleSave}
                  disabled={saveStatus === 'saving'}
                  aria-busy={saveStatus === 'saving'}
                >
                  {saveStatus === 'saving' ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                      Saving…
                    </>
                  ) : (
                    'Save preferences'
                  )}
                </Button>

                {saveStatus === 'saved' && (
                  <p className="flex items-center gap-1 text-sm text-green-600" role="status" aria-live="polite">
                    <CheckCircle className="h-4 w-4" aria-hidden="true" />
                    Preferences saved.
                  </p>
                )}

                {saveStatus === 'error' && saveError && (
                  <p className="flex items-center gap-1 text-sm text-destructive" role="alert">
                    <AlertCircle className="h-4 w-4" aria-hidden="true" />
                    {saveError}
                  </p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
