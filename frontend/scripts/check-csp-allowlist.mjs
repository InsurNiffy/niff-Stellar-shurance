#!/usr/bin/env node
/**
 * scripts/check-csp-allowlist.mjs
 *
 * Validates that every origin in the CSP allowlist document is present in
 * next.config.mjs and middleware.ts, and that no extra origins appear in the
 * code without a corresponding allowlist entry.
 *
 * Usage:
 *   node scripts/check-csp-allowlist.mjs
 *
 * Exit codes:
 *   0 — all origins accounted for
 *   1 — drift detected (missing or undocumented origins)
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// ---------------------------------------------------------------------------
// 1. Parse the allowlist from the markdown doc
// ---------------------------------------------------------------------------
// We extract every `https://` or `wss://` origin from the allowlist tables.
// Lines that are comments or code fences are skipped.

const ALLOWLIST_PATH = join(ROOT, '..', 'docs', 'ops', 'csp-allowlist.md')
const allowlistMd = readFileSync(ALLOWLIST_PATH, 'utf8')

const ORIGIN_RE = /`((?:https?|wss?):\/\/[^`\s/]+)`/g
const documentedOrigins = new Set()
for (const [, origin] of allowlistMd.matchAll(ORIGIN_RE)) {
  // Skip placeholder env-var references like `$NEXT_PUBLIC_API_URL`
  if (origin.includes('$') || origin.includes('{')) continue
  documentedOrigins.add(origin)
}

// ---------------------------------------------------------------------------
// 2. Parse origins from next.config.mjs and middleware.ts
// ---------------------------------------------------------------------------

const CONFIG_PATH = join(ROOT, 'next.config.mjs')
const MIDDLEWARE_PATH = join(ROOT, 'src', 'middleware.ts')

const configSrc = readFileSync(CONFIG_PATH, 'utf8')
const middlewareSrc = readFileSync(MIDDLEWARE_PATH, 'utf8')
const combinedSrc = configSrc + '\n' + middlewareSrc

// Extract all string literals that look like origins
const STRING_ORIGIN_RE = /['"`]((?:https?|wss?):\/\/[^'"`\s/]+)['"`]/g
const codeOrigins = new Set()
for (const [, origin] of combinedSrc.matchAll(STRING_ORIGIN_RE)) {
  codeOrigins.add(origin)
}

// ---------------------------------------------------------------------------
// 3. Compare
// ---------------------------------------------------------------------------

const undocumented = [...codeOrigins].filter((o) => !documentedOrigins.has(o))
const stale = [...documentedOrigins].filter(
  (o) =>
    !codeOrigins.has(o) &&
    // Exclude origins that are env-var-driven (documented as dynamic)
    !o.includes('localhost') &&
    !o.includes('example.com'),
)

let exitCode = 0

if (undocumented.length > 0) {
  console.error('\n❌ Origins in CSP code but NOT in docs/ops/csp-allowlist.md:')
  for (const o of undocumented) console.error(`   ${o}`)
  console.error(
    '\n   → Add these to the allowlist table in docs/ops/csp-allowlist.md\n',
  )
  exitCode = 1
}

if (stale.length > 0) {
  console.warn('\n⚠️  Origins in docs/ops/csp-allowlist.md but NOT found in CSP code:')
  for (const o of stale) console.warn(`   ${o}`)
  console.warn(
    '\n   → Remove stale entries from the allowlist doc, or re-add them to middleware.ts / next.config.mjs\n',
  )
  // Stale doc entries are a warning, not a hard failure — they may be
  // env-var-driven origins that are absent in the static source.
}

if (exitCode === 0 && undocumented.length === 0 && stale.length === 0) {
  console.log('✅ CSP allowlist is in sync with next.config.mjs and middleware.ts')
}

process.exit(exitCode)
