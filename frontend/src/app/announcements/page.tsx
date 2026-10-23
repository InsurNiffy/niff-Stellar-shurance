'use client'

import { useCallback, useEffect, useState } from 'react'
import { MDXRemote } from 'next-mdx-remote'
import { serialize } from 'next-mdx-remote/serialize'

import { getConfig } from '@/config/env'
import { markAnnouncementsRead } from '@/hooks/useAnnouncementUnreadCount'

interface Post {
  id: number
  title: string
  body: string
  authorAddress: string
  publishAt: string | null
  createdAt: string
}

interface PostsResponse {
  data: Post[]
  pagination: { next_cursor: string | null; total: number }
}

export default function AnnouncementsPage() {
  const { apiUrl } = getConfig()
  const [posts, setPosts] = useState<Post[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadPage = useCallback(async (after?: string) => {
    setLoading(true)
    setError(null)
    try {
      const url = new URL('/api/posts', apiUrl)
      url.searchParams.set('status', 'published')
      url.searchParams.set('limit', '20')
      if (after) url.searchParams.set('after', after)
      const response = await fetch(url.toString(), { cache: 'no-store' })
      if (!response.ok) throw new Error(`Failed to load announcements (${response.status})`)
      const page = await response.json() as PostsResponse
      setPosts((current) => after ? [...current, ...page.data.filter((post) => !current.some((item) => item.id === post.id))] : page.data)
      setCursor(page.pagination.next_cursor)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to load announcements')
    } finally {
      setLoading(false)
    }
  }, [apiUrl])

  useEffect(() => {
    void loadPage()
  }, [loadPage])

  useEffect(() => {
    if (posts.length > 0) markAnnouncementsRead(posts.map((post) => post.id))
  }, [posts])

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">Announcements</h1>
        <p className="mt-2 text-sm text-muted-foreground">Product updates and important account notices.</p>
      </header>
      {error && <p role="alert" className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
      <div className="space-y-6">
        {posts.map((post) => <Announcement key={post.id} post={post} />)}
      </div>
      {loading && <p className="py-6 text-sm text-muted-foreground" role="status">Loading announcements…</p>}
      {!loading && cursor && (
        <button type="button" className="mt-8 rounded-md border px-4 py-2 text-sm font-medium" onClick={() => void loadPage(cursor)}>
          Load more
        </button>
      )}
      {!loading && !error && posts.length === 0 && <p className="text-sm text-muted-foreground">No announcements yet.</p>}
    </main>
  )
}

function Announcement({ post }: { post: Post }) {
  const [source, setSource] = useState<Awaited<ReturnType<typeof serialize>> | null>(null)
  useEffect(() => {
    void serialize(post.body).then(setSource).catch(() => setSource(null))
  }, [post.body])
  const date = post.publishAt ?? post.createdAt

  return (
    <article className="border-b pb-6">
      <h2 className="text-xl font-semibold">{post.title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        <time dateTime={date}>{new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</time>
        {' · '}<span className="font-mono">{post.authorAddress.slice(0, 6)}…{post.authorAddress.slice(-4)}</span>
      </p>
      <div className="prose prose-sm dark:prose-invert mt-4 max-w-none">
        {source ? <MDXRemote {...source} /> : <p>{post.body}</p>}
      </div>
    </article>
  )
}
