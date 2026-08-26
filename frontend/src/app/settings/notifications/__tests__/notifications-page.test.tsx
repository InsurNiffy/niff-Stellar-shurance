/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'

import NotificationsPage from '../page'
import {
  getNotificationPreferences,
  patchNotificationPreferences,
} from '@/lib/api/notifications'

jest.mock('@/lib/api/notifications', () => ({
  getNotificationPreferences: jest.fn(),
  patchNotificationPreferences: jest.fn(),
}))

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ jwt: 'mock-jwt-token' }),
}))

jest.mock('@/hooks/use-wallet', () => ({
  useWallet: () => ({ address: 'GABC123' }),
}))

const mockGet = getNotificationPreferences as jest.MockedFunction<typeof getNotificationPreferences>
const mockPatch = patchNotificationPreferences as jest.MockedFunction<typeof patchNotificationPreferences>

const defaultChannels = {
  renewalReminders: { email: true, push: true, inApp: true },
  claimUpdates: { email: true, push: true, inApp: true },
  voteReminders: { email: true, push: true, inApp: true },
  appealOutcome: { email: true, push: true, inApp: true },
}

const defaultPrefs = {
  renewalRemindersEnabled: true,
  claimUpdatesEnabled: true,
  voteRemindersEnabled: false,
  appealOutcomeEnabled: false,
  channels: defaultChannels,
}

describe('NotificationsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGet.mockResolvedValue(defaultPrefs)
    mockPatch.mockResolvedValue(undefined)
  })

  it('fetches and shows current preferences on load', async () => {
    render(<NotificationsPage />)

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /policy renewal reminders/i })).toBeInTheDocument()
    })

    expect(screen.getByRole('switch', { name: /policy renewal reminders/i })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: /claim status updates/i })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: /vote reminders/i })).toHaveAttribute('aria-checked', 'false')
  })

  it('renders all three notification toggles', async () => {
    render(<NotificationsPage />)

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /policy renewal reminders/i })).toBeInTheDocument()
    })

    expect(screen.getByRole('switch', { name: /claim status updates/i })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /vote reminders/i })).toBeInTheDocument()
  })

  it('toggles a preference when clicking the switch', async () => {
    render(<NotificationsPage />)

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /vote reminders/i })).toBeInTheDocument()
    })

    const toggle = screen.getByRole('switch', { name: /vote reminders/i })
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  it('saves updated preferences and shows success confirmation', async () => {
    render(<NotificationsPage />)

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /vote reminders/i })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('switch', { name: /vote reminders/i }))
    await userEvent.click(screen.getByRole('button', { name: /save preferences/i }))

    await waitFor(() => {
      expect(screen.getByText(/preferences saved/i)).toBeInTheDocument()
    })

    expect(mockPatch).toHaveBeenCalledWith(
      'GABC123',
      expect.objectContaining({ voteRemindersEnabled: true }),
      'mock-jwt-token',
    )
  })

  it('shows inline error without resetting unsaved changes on API failure', async () => {
    mockPatch.mockRejectedValueOnce(new Error('Network error'))

    render(<NotificationsPage />)

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /vote reminders/i })).toBeInTheDocument()
    })

    // Toggle vote reminders on
    await userEvent.click(screen.getByRole('switch', { name: /vote reminders/i }))
    expect(screen.getByRole('switch', { name: /vote reminders/i })).toHaveAttribute('aria-checked', 'true')

    await userEvent.click(screen.getByRole('button', { name: /save preferences/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Network error')
    })

    // Toggle state is preserved (unsaved changes not lost)
    expect(screen.getByRole('switch', { name: /vote reminders/i })).toHaveAttribute('aria-checked', 'true')
  })

  it('shows loading state while fetching', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))

    render(<NotificationsPage />)
    expect(screen.getByText(/loading preferences/i)).toBeInTheDocument()
  })

  it('shows fetch error when loading fails', async () => {
    mockGet.mockRejectedValueOnce(new Error('Failed to fetch'))

    render(<NotificationsPage />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to fetch')
    })
  })
})

describe('NotificationsPage — Per-channel toggles', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGet.mockResolvedValue(defaultPrefs)
    mockPatch.mockResolvedValue(undefined)
  })

  it('renders per-channel toggles for each notification type', async () => {
    render(<NotificationsPage />)

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /policy renewal reminders/i })).toBeInTheDocument()
    })

    // Should have 12 channel toggles (4 types x 3 channels)
    const channelSwitches = screen.getAllByRole('switch', { name: /channel$/i })
    expect(channelSwitches).toHaveLength(12)
  })

  it('can disable push for claim updates while keeping email enabled', async () => {
    render(<NotificationsPage />)

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /claim status updates/i })).toBeInTheDocument()
    })

    // Find the push channel toggle for claim updates (asserts it exists)
    screen.getByRole('switch', { name: /push channel/i, hidden: false })
    // There are 3 push toggles; we need the one for claim-updates
    const claimPushToggle = document.getElementById('claim-updates-push') as HTMLButtonElement
    expect(claimPushToggle).not.toBeNull()
    expect(claimPushToggle).toHaveAttribute('aria-checked', 'true')

    await userEvent.click(claimPushToggle)
    expect(claimPushToggle).toHaveAttribute('aria-checked', 'false')

    // Email should still be enabled
    const claimEmailToggle = document.getElementById('claim-updates-email') as HTMLButtonElement
    expect(claimEmailToggle).toHaveAttribute('aria-checked', 'true')
  })

  it('disabling all channels for a type turns off the parent toggle', async () => {
    render(<NotificationsPage />)

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /policy renewal reminders/i })).toBeInTheDocument()
    })

    const parentToggle = screen.getByRole('switch', { name: /policy renewal reminders/i })
    expect(parentToggle).toHaveAttribute('aria-checked', 'true')

    // Disable all three channels for renewal reminders
    const emailToggle = document.getElementById('renewal-reminders-email') as HTMLButtonElement
    const pushToggle = document.getElementById('renewal-reminders-push') as HTMLButtonElement
    const inAppToggle = document.getElementById('renewal-reminders-inApp') as HTMLButtonElement

    await userEvent.click(emailToggle)
    await userEvent.click(pushToggle)
    await userEvent.click(inAppToggle)

    // Parent toggle should now be off
    expect(parentToggle).toHaveAttribute('aria-checked', 'false')
  })

  it('saves combined type+channel preferences', async () => {
    render(<NotificationsPage />)

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /claim status updates/i })).toBeInTheDocument()
    })

    // Disable push for claim updates
    const claimPushToggle = document.getElementById('claim-updates-push') as HTMLButtonElement
    await userEvent.click(claimPushToggle)

    await userEvent.click(screen.getByRole('button', { name: /save preferences/i }))

    await waitFor(() => {
      expect(screen.getByText(/preferences saved/i)).toBeInTheDocument()
    })

    expect(mockPatch).toHaveBeenCalledWith(
      'GABC123',
      expect.objectContaining({
        channels: expect.objectContaining({
          claimUpdates: { email: true, push: false, inApp: true },
        }),
      }),
      'mock-jwt-token',
    )
  })

  it('channel toggles are disabled when parent type is off', async () => {
    render(<NotificationsPage />)

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /vote reminders/i })).toBeInTheDocument()
    })

    // Vote reminders is off by default
    const voteEmailToggle = document.getElementById('vote-reminders-email') as HTMLButtonElement
    expect(voteEmailToggle).toBeDisabled()
  })
})

describe('NotificationsPage — Notification preview (#1123)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGet.mockResolvedValue(defaultPrefs)
    mockPatch.mockResolvedValue(undefined)
  })

  it('shows a preview panel after preferences load', async () => {
    render(<NotificationsPage />)

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /policy renewal reminders/i })).toBeInTheDocument()
    })

    expect(screen.getByLabelText(/sample notification preview/i)).toBeInTheDocument()
  })

  it('preview updates when hovering a different notification type', async () => {
    render(<NotificationsPage />)

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /claim status updates/i })).toBeInTheDocument()
    })

    // Default preview is for renewal reminders
    expect(screen.getByLabelText(/sample notification preview/i)).toHaveTextContent(/renewal/i)

    // Hover over claim updates section
    const claimSection = screen.getByRole('switch', { name: /claim status updates/i }).closest('div')!
    claimSection.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))

    await waitFor(() => {
      expect(screen.getByLabelText(/sample notification preview/i)).toHaveTextContent(/claim/i)
    })
  })

  it('preview never triggers a real notification or side effect', async () => {
    const notificationSpy = jest.spyOn(window, 'Notification' as never)

    render(<NotificationsPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/sample notification preview/i)).toBeInTheDocument()
    })

    // No real Notification was constructed
    expect(notificationSpy).not.toHaveBeenCalled()
    notificationSpy.mockRestore()
  })

  it('saving preferences works as before when preview is shown', async () => {
    render(<NotificationsPage />)

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /vote reminders/i })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('switch', { name: /vote reminders/i }))
    await userEvent.click(screen.getByRole('button', { name: /save preferences/i }))

    await waitFor(() => {
      expect(screen.getByText(/preferences saved/i)).toBeInTheDocument()
    })

    expect(mockPatch).toHaveBeenCalledTimes(1)
  })
})
