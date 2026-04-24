'use client'

import { useEffect, useState } from 'react'
import { onlineManager } from '@tanstack/react-query'

export interface NetworkStatus {
  isOnline: boolean
}

/**
 * Tracks browser online/offline state and syncs React Query's onlineManager
 * so background refetching is automatically paused while offline and resumed
 * on reconnection.
 */
export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true)
      onlineManager.setOnline(true)
    }
    function handleOffline() {
      setIsOnline(false)
      onlineManager.setOnline(false)
    }

    // Sync initial state with React Query
    onlineManager.setOnline(navigator.onLine)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return { isOnline }
}
