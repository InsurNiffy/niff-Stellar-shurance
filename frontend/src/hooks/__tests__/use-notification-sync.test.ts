/**
 * Tests for useNotificationSync — verifies backend PATCH is called on
 * preference changes and skipped when wallet/JWT are absent.
 */

import { renderHook, act, waitFor } from '@testing-library/react'
import { useNotificationSync } from '@/hooks/use-settings'
import * as notificationsApi from '@/lib/api/notifications'

jest.mock('@/lib/api/notifications')
const mockPatch = notificationsApi.patchNotificationPreferences as jest.MockedFunction<
  typeof notificationsApi.patchNotificationPreferences
>

const PREFS = { renewalRemindersEnabled: true, claimUpdatesEnabled: true }
const ADDRESS = 'GABC1234'
const JWT = 'test-jwt'

beforeEach(() => {
  mockPatch.mockResolvedValue(undefined)
})

afterEach(() => {
  jest.clearAllMocks()
})

describe('useNotificationSync', () => {
  it('does not call API when wallet address is null', async () => {
    renderHook(() => useNotificationSync(PREFS, null, JWT))
    await waitFor(() => expect(mockPatch).not.toHaveBeenCalled())
  })

  it('does not call API when JWT is null', async () => {
    renderHook(() => useNotificationSync(PREFS, ADDRESS, null))
    await waitFor(() => expect(mockPatch).not.toHaveBeenCalled())
  })

  it('calls API on mount when address and JWT are present', async () => {
    renderHook(() => useNotificationSync(PREFS, ADDRESS, JWT))
    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1))
    expect(mockPatch).toHaveBeenCalledWith(ADDRESS, PREFS, JWT)
  })

  it('calls API again when preferences change', async () => {
    const { rerender } = renderHook(
      ({ prefs }) => useNotificationSync(prefs, ADDRESS, JWT),
      { initialProps: { prefs: PREFS } },
    )
    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1))

    const newPrefs = { renewalRemindersEnabled: false, claimUpdatesEnabled: true }
    rerender({ prefs: newPrefs })
    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(2))
    expect(mockPatch).toHaveBeenLastCalledWith(ADDRESS, newPrefs, JWT)
  })

  it('does not call API when preferences are unchanged', async () => {
    const { rerender } = renderHook(
      ({ prefs }) => useNotificationSync(prefs, ADDRESS, JWT),
      { initialProps: { prefs: PREFS } },
    )
    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1))

    // Re-render with same prefs object reference — should not re-sync
    rerender({ prefs: { ...PREFS } })
    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1))
  })

  it('exposes syncError when API call fails', async () => {
    mockPatch.mockRejectedValueOnce(new Error('Network error'))
    const { result } = renderHook(() => useNotificationSync(PREFS, ADDRESS, JWT))
    await waitFor(() => expect(result.current.syncError).toBe('Network error'))
  })
})
