/**
 * @jest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react'
import { useIdleTimeout } from '../use-idle-timeout'

describe('useIdleTimeout wallet session warning timing', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('does not show warning before (timeout - warningMs)', () => {
    const onLogout = jest.fn()
    const { result } = renderHook(() =>
      useIdleTimeout({ timeoutMs: 10_000, warningMs: 2_000, onLogout }),
    )

    act(() => {
      jest.advanceTimersByTime(7_999)
    })
    expect(result.current.showWarning).toBe(false)
  })

  it('shows warning at the correct threshold', () => {
    const onLogout = jest.fn()
    const { result } = renderHook(() =>
      useIdleTimeout({ timeoutMs: 10_000, warningMs: 2_000, onLogout }),
    )

    act(() => {
      jest.advanceTimersByTime(8_000)
    })
    expect(result.current.showWarning).toBe(true)
    expect(onLogout).not.toHaveBeenCalled()
  })

  it('still logs out after full timeout when warning is ignored', () => {
    const onLogout = jest.fn()
    renderHook(() => useIdleTimeout({ timeoutMs: 10_000, warningMs: 2_000, onLogout }))

    act(() => {
      jest.advanceTimersByTime(10_001)
    })
    expect(onLogout).toHaveBeenCalledTimes(1)
  })
})
