'use client'

import { useState } from 'react'

interface Section {
  id: string
  heading: string
  body: string
}

interface Props {
  sections: Section[]
}

function highlight(text: string, query: string): string {
  if (!query) return text
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark class="bg-yellow-200 dark:bg-yellow-700 rounded-sm">$1</mark>')
}

export function ClaimsDocsClient({ sections }: Props) {
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const visible = q
    ? sections.filter(
        (s) =>
          s.heading.toLowerCase().includes(q) || s.body.toLowerCase().includes(q),
      )
    : sections

  return (
    <div>
      {/* Search input */}
      <div className="mb-6">
        <label htmlFor="claims-search" className="sr-only">Search claims documentation</label>
        <input
          id="claims-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search claims docs…"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="Search claims documentation"
        />
      </div>

      {/* No-results state */}
      {visible.length === 0 && (
        <p className="text-sm text-muted-foreground" role="status">
          No results for <strong>&ldquo;{query}&rdquo;</strong>. Try a different term or{' '}
          <button
            onClick={() => setQuery('')}
            className="underline text-primary hover:no-underline"
          >
            clear the search
          </button>{' '}
          to view all documentation.
        </p>
      )}

      {/* Sections */}
      {visible.map((section) => (
        <section key={section.id} id={section.id} className="mb-8">
          <h2
            className="text-xl font-semibold mb-3"
            dangerouslySetInnerHTML={{ __html: highlight(section.heading, query) }}
          />
          <div
            className="prose prose-gray dark:prose-invert max-w-none text-sm"
            dangerouslySetInnerHTML={{ __html: highlight(section.body, query) }}
          />
        </section>
      ))}
    </div>
  )
}
