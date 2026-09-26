/**
 * @jest-environment jsdom
 */
import { renderHook, act, waitFor } from '@testing-library/react'
import { useDashboardCardOrder } from '../use-dashboard-card-order'

const STORAGE_KEY = 'niffyinsur-dashboard-card-order-v1'
const DEFAULT_ORDER = ['protocol-stats', 'quick-actions', 'recent-claims']

describe('useDashboardCardOrder', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('starts with the default order when there is no saved preference', async () => {
    const { result } = renderHook(() => useDashboardCardOrder(DEFAULT_ORDER))
    await waitFor(() => expect(result.current.hydrated).toBe(true))
    expect(result.current.order).toEqual(DEFAULT_ORDER)
  })

  it('reorders a card via drag-and-drop and persists the new order', async () => {
    const { result } = renderHook(() => useDashboardCardOrder(DEFAULT_ORDER))
    await waitFor(() => expect(result.current.hydrated).toBe(true))

    act(() => {
      result.current.reorder('recent-claims', 'protocol-stats')
    })

    expect(result.current.order).toEqual(['recent-claims', 'protocol-stats', 'quick-actions'])
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual([
      'recent-claims',
      'protocol-stats',
      'quick-actions',
    ])
  })

  it('restores a previously persisted order on the next mount (reload/new session)', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(['quick-actions', 'recent-claims', 'protocol-stats']),
    )

    const { result } = renderHook(() => useDashboardCardOrder(DEFAULT_ORDER))
    await waitFor(() => expect(result.current.hydrated).toBe(true))

    expect(result.current.order).toEqual(['quick-actions', 'recent-claims', 'protocol-stats'])
  })

  it('drops stale ids and appends new default ids not present in the saved order', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(['quick-actions', 'removed-card']))

    const { result } = renderHook(() => useDashboardCardOrder(DEFAULT_ORDER))
    await waitFor(() => expect(result.current.hydrated).toBe(true))

    expect(result.current.order).toEqual(['quick-actions', 'protocol-stats', 'recent-claims'])
  })

  it('reset() clears the saved preference and restores the default order', async () => {
    const { result } = renderHook(() => useDashboardCardOrder(DEFAULT_ORDER))
    await waitFor(() => expect(result.current.hydrated).toBe(true))

    act(() => {
      result.current.reorder('recent-claims', 'protocol-stats')
    })
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull()

    act(() => {
      result.current.reset()
    })

    expect(result.current.order).toEqual(DEFAULT_ORDER)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('ignores reorder calls with an unknown card id', async () => {
    const { result } = renderHook(() => useDashboardCardOrder(DEFAULT_ORDER))
    await waitFor(() => expect(result.current.hydrated).toBe(true))

    act(() => {
      result.current.reorder('does-not-exist', 'protocol-stats')
    })

    expect(result.current.order).toEqual(DEFAULT_ORDER)
  })
})
