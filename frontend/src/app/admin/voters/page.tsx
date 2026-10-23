'use client'

import { useCallback, useEffect, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import Link from 'next/link'

import { VoterRegistry } from '@/components/admin/VoterRegistry'
import { useAuth } from '@/lib/hooks/useAuth'
import { adminApi, type RegisteredVoter } from '@/lib/api/admin'

function isStaff(jwt: string | null): boolean {
  if (!jwt) return false
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload?.role === 'admin' || payload?.isAdmin === true
  } catch {
    return false
  }
}

export default function AdminVotersPage() {
  const { jwt } = useAuth()

  if (!jwt) {
    return (
      <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <ShieldAlert className="h-12 w-12 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-xl font-semibold">Authentication required</h1>
        <p className="text-sm text-muted-foreground">Connect your wallet and sign in to continue.</p>
      </main>
    )
  }

  if (!isStaff(jwt)) {
    return (
      <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-6xl font-bold text-destructive">403</p>
        <h1 className="text-2xl font-semibold">Access denied</h1>
        <p className="text-muted-foreground max-w-sm">You do not have permission to view this page.</p>
        <Link href="/" className="text-primary underline underline-offset-4 text-sm">Return home</Link>
      </main>
    )
  }

  return <VoterAdmin jwt={jwt} />
}

function VoterAdmin({ jwt }: { jwt: string }) {
  const [voters, setVoters] = useState<RegisteredVoter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    adminApi.listVoters(jwt)
      .then((v) => { setVoters(v); setError(null) })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load voters'))
      .finally(() => setLoading(false))
  }, [jwt])

  useEffect(() => { load() }, [load])

  async function handleRegister(walletAddress: string) {
    await adminApi.registerVoter(jwt, walletAddress)
    load()
  }

  async function handleRemove(walletAddress: string) {
    try {
      await adminApi.deleteVoter(jwt, walletAddress)
      load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Remove failed')
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Voter Registration</h1>
        <Link href="/admin" className="text-sm text-primary underline underline-offset-2">Back to dashboard</Link>
      </div>
      <VoterRegistry
        voters={voters}
        loading={loading}
        error={error}
        onRegister={handleRegister}
        onRemove={handleRemove}
      />
    </main>
  )
}
