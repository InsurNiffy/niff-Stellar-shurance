'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Shield, Megaphone } from 'lucide-react'
import { useAnnouncementUnreadCount } from '@/hooks/useAnnouncementUnreadCount'

import { ThemeToggle } from '@/components/theme-toggle'
import { LocaleSwitcher } from '@/components/LocaleSwitcher'
import { ConnectWalletButton } from '@/features/wallet/ConnectWalletButton'
import { cn } from '@/lib/utils'

interface SiteHeaderProps {
  className?: string
}

/**
 * SiteHeader — top navigation bar shown on desktop (hidden on mobile where
 * the BottomTabBar takes over). Contains the brand logo, primary nav links,
 * and the wallet / locale / theme controls.
 */
export function SiteHeader({ className }: SiteHeaderProps) {
  const unreadCount = useAnnouncementUnreadCount()
  const pathname = usePathname()
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  return (
    <header
      className={cn(
        'sticky top-0 z-30 hidden md:flex w-full items-center border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80',
        className
      )}
    >
      <div className="container mx-auto flex h-14 items-center justify-between px-4">
        {/* Brand */}
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold text-foreground hover:text-primary transition-colors"
          aria-label="NiffyInsur home"
        >
          <Shield className="h-5 w-5 text-primary" aria-hidden="true" />
          <span>NiffyInsur</span>
        </Link>

        {/* Primary nav */}
        <nav aria-label="Primary navigation" className="flex items-center gap-1">
          {[
            { href: '/policies', label: 'Policies' },
            { href: '/claims', label: 'Claims' },
            { href: '/docs', label: 'Docs' },
          ].map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? 'page' : undefined}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors hover:text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                isActive(href) ? 'bg-accent font-semibold text-foreground' : 'text-muted-foreground'
              }`}
            >
              {label}
            </Link>
          ))}
          <Link
            href="/announcements"
            className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Megaphone size={15} aria-hidden="true" />
            Announcements
            {unreadCount > 0 && <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground" aria-label={`${unreadCount} unread announcements`}>{unreadCount}</span>}
          </Link>
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <ConnectWalletButton />
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
