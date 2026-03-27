#!/usr/bin/env node
/**
 * Checks that every internal link in src/content/*.mdx resolves to a known
 * /docs/* route. Exits 1 if any broken links are found.
 */
const fs = require('fs')
const path = require('path')

const CONTENT_DIR = path.join(__dirname, '..', 'src', 'content')
const VALID_ROUTES = new Set([
  '/docs/voting',
  '/docs/claims',
  '/docs/treasury',
  '/docs/contracts',
])

const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g

let broken = 0

for (const file of fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.mdx'))) {
  const src = fs.readFileSync(path.join(CONTENT_DIR, file), 'utf8')
  for (const [, , href] of src.matchAll(LINK_RE)) {
    if (!href.startsWith('/')) continue // skip external links
    if (!VALID_ROUTES.has(href)) {
      console.error(`[broken-link] ${file}: "${href}" is not a valid docs route`)
      broken++
    }
  }
}

if (broken > 0) {
  console.error(`\n${broken} broken internal link(s) found.`)
  process.exit(1)
} else {
  console.log('All internal docs links OK.')
}
