import type { Meta, StoryObj } from '@storybook/react'
import { StatusBadge } from './status-badge'

const meta: Meta<typeof StatusBadge> = {
  title: 'UI/StatusBadge',
  component: StatusBadge,
  tags: ['autodocs'],
  argTypes: {
    status: {
      control: 'select',
      options: ['active', 'expired', 'pending', 'approved', 'rejected', 'under_review'],
    },
  },
}
export default meta
type Story = StoryObj<typeof StatusBadge>

export const Active: Story = { args: { status: 'active' } }
export const Pending: Story = { args: { status: 'pending' } }
export const UnderReview: Story = { args: { status: 'under_review' } }
export const Approved: Story = { args: { status: 'approved' } }
export const Rejected: Story = { args: { status: 'rejected' } }
export const Expired: Story = { args: { status: 'expired' } }

export const AllStates: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {(['active', 'pending', 'under_review', 'approved', 'rejected', 'expired'] as const).map(
        (s) => <StatusBadge key={s} status={s} />,
      )}
    </div>
  ),
}
