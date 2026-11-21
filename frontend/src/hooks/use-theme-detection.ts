'use client'

import { useEffect, useState } from 'react'

import { type Theme, useTheme } from '@/components/theme-provider'

export type ResolvedTheme = 'dark' | 'light'

export interface ThemeDetection {
  /** The user's preference, including 'system'. */
  theme: Theme
  /** The theme actually applied to the document. */
  resolvedTheme: ResolvedTheme
  /** The current OS-level preference. */
  systemTheme: ResolvedTheme
  isDark: boolean
  setTheme: (theme: Theme) => void
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Exposes the effective theme to components that need to react to theme
 * changes (including OS preference changes while the user follows "system").
 */
export function useThemeDetection(): ThemeDetection {
  const { theme, setTheme } = useTheme()
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? 'dark' : 'light')
    }
    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [])

  const resolvedTheme: ResolvedTheme = theme === 'system' ? systemTheme : theme

  return { theme, resolvedTheme, systemTheme, isDark: resolvedTheme === 'dark', setTheme }
}

export default useThemeDetection
