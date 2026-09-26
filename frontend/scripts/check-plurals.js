#!/usr/bin/env node
/**
 * check-plurals.js
 *
 * Flags message values that look like countable quantities (a `{placeholder}`
 * immediately followed by a plural-sensitive unit word, e.g. "{days} days")
 * but do not use ICU `plural` syntax for that placeholder. Such strings
 * render an incorrect count in locales whose plural rules differ from
 * English (e.g. "1 days"), and some locales (ar, ru, pl...) have more than
 * two plural categories entirely.
 *
 * Usage: node scripts/check-plurals.js
 */

const fs = require('fs')
const path = require('path')

const MESSAGES_DIR = path.resolve(__dirname, '../messages')
const BASE_LOCALE = 'en'
const CATALOGS = ['common', 'policy', 'claims', 'wallet']

// Unit words that commonly follow a numeric placeholder in this app's copy.
// Extend this list as new countable concepts are introduced.
const COUNTABLE_UNITS = [
  'day', 'days',
  'ledger', 'ledgers',
  'item', 'items',
  'claim', 'claims',
  'policy', 'policies',
  'vote', 'votes',
  'result', 'results',
  'hour', 'hours',
  'block', 'blocks',
]

const COUNTABLE_UNIT_PATTERN = new RegExp(
  `\\{\\s*(\\w+)\\s*\\}\\s*\\(?\\s*(${COUNTABLE_UNITS.join('|')})\\b`,
  'i',
)

function flatten(obj, prefix = '') {
  return Object.entries(obj).reduce((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') Object.assign(acc, flatten(v, key))
    else acc[key] = v
    return acc
  }, {})
}

/**
 * Returns true if `value` contains ICU plural syntax for `placeholder`
 * (e.g. `{days, plural, one {...} other {...}}`).
 */
function hasIcuPluralFor(value, placeholder) {
  const pluralPattern = new RegExp(`\\{\\s*${placeholder}\\s*,\\s*plural\\s*,`, 'i')
  return pluralPattern.test(value)
}

function findCountableStringsMissingPlurals(messages) {
  const flat = flatten(messages)
  const problems = []

  for (const [key, value] of Object.entries(flat)) {
    if (typeof value !== 'string') continue
    const match = value.match(COUNTABLE_UNIT_PATTERN)
    if (!match) continue

    const placeholder = match[1]
    if (!hasIcuPluralFor(value, placeholder)) {
      problems.push({ key, value, placeholder })
    }
  }

  return problems
}

function main() {
  const locales = fs
    .readdirSync(MESSAGES_DIR)
    .filter((d) => fs.statSync(path.join(MESSAGES_DIR, d)).isDirectory())

  let failed = false

  for (const catalog of CATALOGS) {
    for (const locale of locales) {
      const filePath = path.join(MESSAGES_DIR, locale, `${catalog}.json`)
      if (!fs.existsSync(filePath)) continue

      const messages = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      const problems = findCountableStringsMissingPlurals(messages)

      for (const { key, value, placeholder } of problems) {
        console.error(
          `[i18n:plurals] ${locale}/${catalog}.json "${key}" looks countable ` +
          `(placeholder "{${placeholder}}") but has no ICU plural form: ${JSON.stringify(value)}`,
        )
        failed = true
      }
    }
  }

  if (failed) {
    console.error('\n[i18n:plurals] Plural check FAILED. Wrap the flagged placeholders in ICU `plural` syntax, e.g.:')
    console.error('  "{count, plural, one {# item} other {# items}}"')
    process.exit(1)
  } else {
    console.log('[i18n:plurals] All countable strings have ICU plural forms. ✓')
  }
}

if (require.main === module) {
  main()
}

module.exports = { findCountableStringsMissingPlurals, hasIcuPluralFor, flatten, BASE_LOCALE, CATALOGS }
