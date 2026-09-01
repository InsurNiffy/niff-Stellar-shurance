#!/usr/bin/env node
/**
 * check-translations.js
 *
 * Compares every key in the `en` message catalogs against all other locales.
 * Exits with code 1 (fails CI) if any key present in `en` is missing elsewhere.
 *
 * Usage: node scripts/check-translations.js
 */

const fs = require('fs')
const path = require('path')

const MESSAGES_DIR = path.resolve(__dirname, '../messages')
const BASE_LOCALE = 'en'

/** Flatten nested object to dot-notation keys */
function flatten(obj, prefix = '') {
  return Object.entries(obj).reduce((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') Object.assign(acc, flatten(v, key))
    else acc[key] = v
    return acc
  }, {})
}

/**
 * Returns the base-locale keys missing from `localeMessages`.
 * Exported so tests (including fixture-based ones) can exercise the same
 * detection logic that backs the CLI/CI check below.
 */
function findMissingKeys(baseMessages, localeMessages) {
  const baseKeys = Object.keys(flatten(baseMessages))
  const localeKeys = new Set(Object.keys(flatten(localeMessages)))
  return baseKeys.filter((key) => !localeKeys.has(key))
}

function main() {
  const locales = fs.readdirSync(MESSAGES_DIR).filter((d) =>
    fs.statSync(path.join(MESSAGES_DIR, d)).isDirectory()
  )

  const catalogs = ['common', 'policy', 'claims', 'wallet']
  let failed = false

  for (const catalog of catalogs) {
    const basePath = path.join(MESSAGES_DIR, BASE_LOCALE, `${catalog}.json`)
    if (!fs.existsSync(basePath)) continue
    const baseMessages = JSON.parse(fs.readFileSync(basePath, 'utf8'))

    for (const locale of locales) {
      if (locale === BASE_LOCALE) continue
      const localePath = path.join(MESSAGES_DIR, locale, `${catalog}.json`)
      if (!fs.existsSync(localePath)) {
        console.error(`[i18n] MISSING FILE: messages/${locale}/${catalog}.json`)
        failed = true
        continue
      }
      const localeMessages = JSON.parse(fs.readFileSync(localePath, 'utf8'))
      for (const key of findMissingKeys(baseMessages, localeMessages)) {
        console.error(`[i18n] MISSING KEY in ${locale}/${catalog}.json: "${key}"`)
        failed = true
      }
    }
  }

  if (failed) {
    console.error('\n[i18n] Translation check FAILED. Add missing keys before merging.')
    process.exit(1)
  } else {
    console.log('[i18n] All translation keys present. ✓')
  }
}

if (require.main === module) {
  main()
}

module.exports = { flatten, findMissingKeys, MESSAGES_DIR, BASE_LOCALE }
