import { readFile } from 'fs/promises'
import path from 'path'

import { ClaimsDocsClient } from './ClaimsDocsClient'

export const metadata = { title: 'Claim Timelines — NiffyInsur Docs' }

/** Split MDX source into titled sections for client-side search (#1125). */
function parseSections(source: string): { id: string; heading: string; body: string }[] {
  const lines = source.split('\n')
  const sections: { id: string; heading: string; body: string }[] = []
  let current: { id: string; heading: string; body: string } | null = null

  for (const line of lines) {
    const match = line.match(/^#{1,3} (.+)/)
    if (match) {
      if (current) sections.push(current)
      const heading = match[1].trim()
      const id = heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      current = { id, heading, body: '' }
    } else if (current) {
      current.body += line + '\n'
    }
  }
  if (current) sections.push(current)
  return sections
}

export default async function ClaimsPage() {
  const src = await readFile(
    path.join(process.cwd(), 'src', 'content', 'claims.mdx'),
    'utf8',
  )
  const sections = parseSections(src)
  return <ClaimsDocsClient sections={sections} />
}
