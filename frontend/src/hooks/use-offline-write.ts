'use client'

import { useCallback, useState } from 'react'

import { useNetworkStatus } from './use-network-status'

const OFFLINE_MESSAGE =
  "You're offline. This change was not saved and nothing was queued. Reconnect, then retry."

/**
 * Wraps a write (transaction / mutation) so an offline failure is explicit.
 * Writes are never silently queued: callers receive an error and a manual
 * `retry` callback that can be rendered with <WriteRetryButton />.
 */
export function useOfflineWrite<TArgs extends unknown[], TResult>(
  write: (...args: TArgs) => Promise<TResult>,
) {
  const { isOnline } = useNetworkStatus()
  const [error, setError] = useState<string | null>(null)
  const [failedArgs, setFailedArgs] = useState<TArgs | null>(null)

  const run = useCallback(
    async (...args: TArgs): Promise<TResult> => {
      if (!isOnline || (typeof navigator !== 'undefined' && !navigator.onLine)) {
        setError(OFFLINE_MESSAGE)
        setFailedArgs(args)
        throw new Error(OFFLINE_MESSAGE)
      }

      try {
        const result = await write(...args)
        setError(null)
        setFailedArgs(null)
        return result
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'The change could not be saved. Please retry.')
        setFailedArgs(args)
        throw cause
      }
    },
    [isOnline, write],
  )

  const retry = useCallback(() => {
    if (!failedArgs || !isOnline) return
    void run(...failedArgs).catch(() => {
      // The error state is already set by `run`; keep it visible for retry.
    })
  }, [failedArgs, isOnline, run])

  return { run, error, retry: failedArgs ? retry : null }
}
