import type { Meta, StoryObj } from '@storybook/react'

import { FraudScoreBadge } from './FraudScoreBadge'

const meta: Meta<typeof FraudScoreBadge> = {
  title: 'Claims/FraudScoreBadge',
  component: FraudScoreBadge,
  tags: ['autodocs'],
  args: {
    score: 50,
  },
}
export default meta
type Story = StoryObj<typeof FraudScoreBadge>

export const LowRisk: Story = { args: { score: 15 } }
export const MediumRisk: Story = { args: { score: 55 } }
export const HighRisk: Story = { args: { score: 90 } }
