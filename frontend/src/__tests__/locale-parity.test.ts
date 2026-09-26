/**
 * @jest-environment node
 *
 * Mirrors the CI check in scripts/check-translations.js: a message key
 * present in the base (en) locale must exist in every other locale. Uses a
 * fixture with an intentionally missing key to prove the detector actually
 * catches the failure mode it exists to prevent, and also runs against the
 * real catalogs to keep this repo's translations honest.
 */

import fs from 'fs'
import path from 'path'
import { findMissingKeys } from '../../scripts/check-translations.js'

describe('locale key parity — fixture detection', () => {
  const fixtureDir = path.resolve(__dirname, 'fixtures/i18n-missing-key')
  const baseFixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'en/sample.json'), 'utf8'))
  const localeFixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'es/sample.json'), 'utf8'))

  it('flags a key present in the base locale but missing from another locale', () => {
    const missing = findMissingKeys(baseFixture, localeFixture)
    expect(missing).toEqual(['banner.cta'])
  })

  it('reports no missing keys when locales are fully translated', () => {
    const missing = findMissingKeys(baseFixture, baseFixture)
    expect(missing).toEqual([])
  })
})

describe('locale key parity — real catalogs', () => {
  const MESSAGES_DIR = path.resolve(__dirname, '../../messages')
  const BASE_LOCALE = 'en'
  const CATALOGS = ['common', 'policy', 'claims', 'wallet']

  const locales = fs
    .readdirSync(MESSAGES_DIR)
    .filter((d) => fs.statSync(path.join(MESSAGES_DIR, d)).isDirectory())
    .filter((d) => d !== BASE_LOCALE)

  for (const catalog of CATALOGS) {
    const basePath = path.join(MESSAGES_DIR, BASE_LOCALE, `${catalog}.json`)
    if (!fs.existsSync(basePath)) continue
    const baseMessages = JSON.parse(fs.readFileSync(basePath, 'utf8'))

    for (const locale of locales) {
      it(`${locale}/${catalog}.json has no keys missing relative to ${BASE_LOCALE}`, () => {
        const localePath = path.join(MESSAGES_DIR, locale, `${catalog}.json`)
        expect(fs.existsSync(localePath)).toBe(true)
        const localeMessages = JSON.parse(fs.readFileSync(localePath, 'utf8'))
        expect(findMissingKeys(baseMessages, localeMessages)).toEqual([])
      })
    }
  }
})
