import type { Meta, StoryObj } from '@storybook/react'
import { LedgerCountdown } from '../claims/LedgerCountdown'

// Static mock data — no live Stellar node required
const CURRENT = 50_000
const meta: Meta<typeof LedgerCountdown> = {
  title: 'UI/LedgerCountdown',
  component: LedgerCountdown,
  tags: ['autodocs'],
  args: { currentLedger: CURRENT, avgCloseSeconds: 5 },
}
export default meta
type Story = StoryObj<typeof LedgerCountdown>

export const HoursRemaining: Story = {
  args: { targetLedger: CURRENT + 720 }, // ~1 h
}
export const DaysRemaining: Story = {
  args: { targetLedger: CURRENT + 17_280 }, // ~1 d
}
export const MinutesRemaining: Story = {
  args: { targetLedger: CURRENT + 12 }, // ~1 min
}
export const DeadlinePassed: Story = {
  args: { targetLedger: CURRENT - 1 },
}
