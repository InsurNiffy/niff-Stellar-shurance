import { walletSupportsSilentReconnect } from '../utils/silentReconnect'

jest.mock('@creit.tech/stellar-wallets-kit/modules/freighter', () => ({
  FreighterModule: jest.fn().mockImplementation(() => ({
    isAvailable: jest.fn().mockResolvedValue(true),
  })),
  FREIGHTER_ID: 'freighter',
}))

jest.mock('@creit.tech/stellar-wallets-kit/modules/xbull', () => ({
  xBullModule: jest.fn().mockImplementation(() => ({
    isAvailable: jest.fn().mockResolvedValue(false),
  })),
  XBULL_ID: 'xbull',
}))

jest.mock('@creit.tech/stellar-wallets-kit/modules/lobstr', () => ({
  LobstrModule: jest.fn().mockImplementation(() => ({
    isAvailable: jest.fn().mockResolvedValue(true),
  })),
  LOBSTR_ID: 'lobstr',
}))

describe('walletSupportsSilentReconnect', () => {
  it('returns true when the wallet module is available', async () => {
    await expect(walletSupportsSilentReconnect('freighter' as const)).resolves.toBe(true)
  })

  it('returns false when the wallet module is not available', async () => {
    await expect(walletSupportsSilentReconnect('xbull' as const)).resolves.toBe(false)
  })
})
