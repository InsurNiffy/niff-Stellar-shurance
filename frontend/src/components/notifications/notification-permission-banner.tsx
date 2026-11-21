'use client'

import { useState } from 'react'
import { BellRing } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * Prompts for browser push permission only after the user explicitly opts in
 * by clicking the button — merely opening the settings page never prompts.
 */
export function NotificationPermissionBanner() {
  const [dismissed, setDismissed] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission | null>(() =>
    typeof Notification === 'undefined' ? null : Notification.permission,
  )

  if (dismissed || permission !== 'default') return null

  const enable = async () => {
    const result = await Notification.requestPermission()
    setPermission(result)
    setDismissed(result !== 'granted')
  }

  return (
    <div
      role="status"
      className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm"
    >
      <BellRing className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <p className="flex-1 text-muted-foreground">
        You opted in to push notifications. Enable them in your browser to receive alerts.
      </p>
      <Button size="sm" onClick={enable}>Enable browser notifications</Button>
      <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>Not now</Button>
    </div>
  )
}
