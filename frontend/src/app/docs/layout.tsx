import { DocsSidebar } from '@/components/docs/docs-sidebar'
import Link from 'next/link'

const GIT_SHA = process.env.NEXT_PUBLIC_GIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? ''

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white px-6 py-3 flex items-center gap-4">
        <Link href="/" className="text-sm font-semibold text-blue-600 hover:underline">
          ← NiffyInsur
        </Link>
        <span className="text-gray-300">|</span>
        <Link href="/docs/voting" className="text-sm font-medium text-gray-700">
          Docs
        </Link>
      </header>

      <div className="flex flex-1 max-w-5xl mx-auto w-full px-4 py-8 gap-8">
        <DocsSidebar />
        <main className="flex-1 min-w-0 prose prose-gray max-w-none">{children}</main>
      </div>

      <footer className="border-t px-6 py-3 text-xs text-gray-400 flex justify-between">
        <span>NiffyInsur Docs</span>
        {GIT_SHA && <span>Version: {GIT_SHA.slice(0, 7)}</span>}
      </footer>
    </div>
  )
}
