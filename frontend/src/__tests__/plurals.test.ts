/**
 * @jest-environment node
 *
 * Verifies (a) the real message catalogs contain no countable string missing
 * ICU plural forms, and (b) the checker actually catches a newly introduced
 * countable string that's missing plural forms — mirrors the CI check in
 * scripts/check-plurals.js.
 */

import fs from 'fs'
import path from 'path'
import { findCountableStringsMissingPlurals, CATALOGS } from '../../scripts/check-plurals.js'

const MESSAGES_DIR = path.resolve(__dirname, '../../messages')

describe('i18n plural completeness', () => {
  const locales = fs
    .readdirSync(MESSAGES_DIR)
    .filter((d) => fs.statSync(path.join(MESSAGES_DIR, d)).isDirectory())

  for (const catalog of CATALOGS) {
    for (const locale of locales) {
      const filePath = path.join(MESSAGES_DIR, locale, `${catalog}.json`)
      if (!fs.existsSync(filePath)) continue

      it(`${locale}/${catalog}.json has no countable strings missing plural forms`, () => {
        const messages = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        const problems = findCountableStringsMissingPlurals(messages)
        expect(problems).toEqual([])
      })
    }
  }

  it('flags a countable-looking string that lacks ICU plural forms (fixture)', () => {
    const fixture = {
      claims: {
        // Intentionally missing ICU plural syntax — should be caught.
        openCount: 'You have {count} claims awaiting review',
      },
    }
    const problems = findCountableStringsMissingPlurals(fixture)
    expect(problems).toHaveLength(1)
    expect(problems[0].key).toBe('claims.openCount')
    expect(problems[0].placeholder).toBe('count')
  })

  it('does not flag a properly pluralized countable string', () => {
    const fixture = {
      claims: {
        openCount: '{count, plural, one {You have # claim awaiting review} other {You have # claims awaiting review}}',
      },
    }
    expect(findCountableStringsMissingPlurals(fixture)).toEqual([])
  })

  it('does not flag non-countable strings', () => {
    const fixture = {
      common: {
        greeting: 'Welcome back, {name}',
        cta: 'Submit',
      },
    }
    expect(findCountableStringsMissingPlurals(fixture)).toEqual([])
  })
})
