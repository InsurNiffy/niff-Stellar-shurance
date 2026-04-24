'use client'

import { Button } from '@/components/ui/button'
import { useNetworkStatus } from '@/hooks/use-network-status'

interface WriteRetryButtonProps {
  onRetry: () => void
  label?: string
  disabled?: boolean
}

/**
 * Shown after a write operation (transaction) fails while offline.
 * Write ops must NOT auto-retry — the user must explicitly confirm.
 */
export function WriteRetryButton({
  onRetry,
  label = 'Retry',
  disabled,
}: WriteRetryButtonProps) {
  const { isOnline } = useNetworkStatus()

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onRetry}
      disabled={disabled || !isOnline}
      title={!isOnline ? 'Reconnect to retry' : undefined}
    >
      {label}
    </Button>
  )
}
