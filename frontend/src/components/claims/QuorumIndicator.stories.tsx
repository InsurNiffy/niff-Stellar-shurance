import type { Meta, StoryObj } from '@storybook/react'

import { QuorumIndicator } from './QuorumIndicator'

const meta: Meta<typeof QuorumIndicator> = {
  title: 'Claims/QuorumIndicator',
  component: QuorumIndicator,
  tags: ['autodocs'],
  args: {
    approveVotes: 3,
    rejectVotes: 1,
    quorumThreshold: 10,
  },
}
export default meta
type Story = StoryObj<typeof QuorumIndicator>

export const Empty: Story = { args: { approveVotes: 0, rejectVotes: 0, quorumThreshold: 10 } }
export const InProgress: Story = { args: { approveVotes: 3, rejectVotes: 1, quorumThreshold: 10 } }
export const QuorumReached: Story = { args: { approveVotes: 7, rejectVotes: 3, quorumThreshold: 10 } }
export const OverQuorum: Story = { args: { approveVotes: 9, rejectVotes: 4, quorumThreshold: 10 } }
