import { passphraseToAppNetwork } from '@/config/networkManifest'
import {
  computeNetworkMismatch,
  isReadOnlyWalletInteractionPath,
  stripLocalePrefix,
} from '@/features/wallet/utils/networkMismatch'

describe('stripLocalePrefix', () => {
  it('removes optional locale segment', () => {
    expect(stripLocalePrefix('/es/quote')).toBe('/quote')
    expect(stripLocalePrefix('/en/docs/voting')).toBe('/docs/voting')
    expect(stripLocalePrefix('/es')).toBe('/')
  })

  it('leaves default-locale paths unchanged', () => {
    expect(stripLocalePrefix('/quote')).toBe('/quote')
    expect(stripLocalePrefix('/')).toBe('/')
  })
})

describe('isReadOnlyWalletInteractionPath', () => {
  it('treats landing, docs, privacy, support as read-only', () => {
    expect(isReadOnlyWalletInteractionPath('/')).toBe(true)
    expect(isReadOnlyWalletInteractionPath('/docs')).toBe(true)
    expect(isReadOnlyWalletInteractionPath('/docs/voting')).toBe(true)
    expect(isReadOnlyWalletInteractionPath('/privacy')).toBe(true)
    expect(isReadOnlyWalletInteractionPath('/support')).toBe(true)
  })

  it('treats wallet-interaction routes as not read-only', () => {
    expect(isReadOnlyWalletInteractionPath('/quote')).toBe(false)
    expect(isReadOnlyWalletInteractionPath('/settings')).toBe(false)
    expect(isReadOnlyWalletInteractionPath('/dashboard')).toBe(false)
  })

  it('respects locale prefix', () => {
    expect(isReadOnlyWalletInteractionPath('/es')).toBe(true)
    expect(isReadOnlyWalletInteractionPath('/es/docs/contracts')).toBe(true)
    expect(isReadOnlyWalletInteractionPath('/es/quote')).toBe(false)
  })
})

describe('computeNetworkMismatch', () => {
  it('is false when disconnected or resolution not ok', () => {
    expect(
      computeNetworkMismatch('disconnected', 'mainnet', { status: 'ok', mappedNetwork: 'testnet' }),
    ).toBe(false)
    expect(
      computeNetworkMismatch('connected', 'mainnet', { status: 'idle' }),
    ).toBe(false)
    expect(
      computeNetworkMismatch('connected', 'mainnet', { status: 'error' }),
    ).toBe(false)
  })

  it('is true when mapped network differs from app network', () => {
    expect(
      computeNetworkMismatch('connected', 'mainnet', { status: 'ok', mappedNetwork: 'testnet' }),
    ).toBe(true)
  })

  it('is false when networks match', () => {
    expect(
      computeNetworkMismatch('connected', 'testnet', { status: 'ok', mappedNetwork: 'testnet' }),
    ).toBe(false)
  })

  it('is true when passphrase is unknown (unmapped)', () => {
    expect(
      computeNetworkMismatch('connected', 'mainnet', { status: 'ok', mappedNetwork: null }),
    ).toBe(true)
  })
})

describe('passphraseToAppNetwork', () => {
  it('maps known Stellar passphrases', () => {
    expect(passphraseToAppNetwork('Test SDF Network ; September 2015')).toBe('testnet')
    expect(
      passphraseToAppNetwork('Public Global Stellar Network ; September 2015'),
    ).toBe('mainnet')
  })

  it('returns null for unknown passphrases', () => {
    expect(passphraseToAppNetwork('Private Custom Network')).toBeNull()
  })
})
