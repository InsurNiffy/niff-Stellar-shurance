'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { Menu, X } from 'lucide-react'

const NAV = [
  { href: '/docs/voting', label: 'Voting Mechanics' },
  { href: '/docs/claims', label: 'Claim Timelines' },
  { href: '/docs/treasury', label: 'Treasury & Pause' },
  { href: '/docs/contracts', label: 'Contract Addresses' },
]

function NavLinks({ onClick }: { onClick?: () => void }) {
  const pathname = usePathname()
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          onClick={onClick}
          className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
            pathname === href
              ? 'bg-blue-100 text-blue-700'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
          }`}
        >
          {label}
        </Link>
      ))}
    </nav>
  )
}

export function DocsSidebar() {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Mobile toggle */}
      <button
        className="md:hidden fixed top-4 left-4 z-50 p-2 rounded-md bg-white shadow border"
        onClick={() => setOpen((v) => !v)}
        aria-label="Toggle docs navigation"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div
            className="fixed inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <aside className="relative z-50 w-64 bg-white p-6 shadow-xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4">
              Documentation
            </p>
            <NavLinks onClick={() => setOpen(false)} />
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:block w-56 shrink-0">
        <div className="sticky top-8">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4">
            Documentation
          </p>
          <NavLinks />
        </div>
      </aside>
    </>
  )
}
