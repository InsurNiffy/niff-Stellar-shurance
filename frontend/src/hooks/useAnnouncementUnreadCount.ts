'use client'

import { useEffect, useState } from 'react'

import { getConfig } from '@/config/env'

const READ_KEY = 'niffyinsur-announcements-read'
const READ_EVENT = 'niffyinsur:announcements-read'

interface AnnouncementPage {
  data: Array<{ id: number }>
}

export function getReadAnnouncementIds(): number[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(READ_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((id): id is number => Number.isSafeInteger(id)) : []
  } catch {
    return []
  }
}

export function markAnnouncementsRead(ids: number[]): void {
  try {
    const readIds = new Set([...getReadAnnouncementIds(), ...ids])
    localStorage.setItem(READ_KEY, JSON.stringify([...readIds]))
    window.dispatchEvent(new Event(READ_EVENT))
  } catch {
    return
  }
}

export function useAnnouncementUnreadCount(): number {
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    const { apiUrl } = getConfig()
    let cancelled = false
    let latestPostIds: number[] = []

    const updateCount = () => {
      const readIds = new Set(getReadAnnouncementIds())
      setUnreadCount(latestPostIds.filter((id) => !readIds.has(id)).length)
    }

    const loadAnnouncements = async () => {
      try {
        const response = await fetch(`${apiUrl}/api/posts?status=published&limit=20`, { cache: 'no-store' })
        if (!response.ok) throw new Error(`Failed to load announcements (${response.status})`)
        const page = await response.json() as AnnouncementPage
        if (cancelled) return
        latestPostIds = page.data.map((post) => post.id)
        updateCount()
      } catch {
        if (!cancelled) setUnreadCount(0)
      }
    }

    void loadAnnouncements()
    window.addEventListener(READ_EVENT, updateCount)
    window.addEventListener('storage', updateCount)
    return () => {
      cancelled = true
      window.removeEventListener(READ_EVENT, updateCount)
      window.removeEventListener('storage', updateCount)
    }
  }, [])

  return unreadCount
}
