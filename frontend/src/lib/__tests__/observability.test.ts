jest.mock('@/lib/analytics', () => ({
  trackRouteSegmentError: jest.fn(),
}))

import { trackRouteSegmentError } from '@/lib/analytics'
import { logRouteSegmentError } from '@/lib/observability'

describe('logRouteSegmentError', () => {
  const origEnv = process.env.NODE_ENV

  afterEach(() => {
    process.env.NODE_ENV = origEnv
    jest.clearAllMocks()
  })

  it('forwards only segment, error name, and digest to analytics in production', () => {
    process.env.NODE_ENV = 'production'
    const err = Object.assign(new Error('do not leak this message'), {
      digest: 'dig-9',
    })
    err.name = 'ChunkLoadError'

    logRouteSegmentError({ segment: 'claims', error: err })

    expect(trackRouteSegmentError).toHaveBeenCalledWith({
      segment: 'claims',
      errorName: 'ChunkLoadError',
      digest: 'dig-9',
    })
    expect(JSON.stringify(trackRouteSegmentError.mock.calls)).not.toMatch(/do not leak/)
  })

  it('does not call Plausible track in non-production', () => {
    process.env.NODE_ENV = 'test'
    logRouteSegmentError({
      segment: 'admin',
      error: Object.assign(new Error('x'), { digest: 'd' }),
    })
    expect(trackRouteSegmentError).not.toHaveBeenCalled()
  })
})
