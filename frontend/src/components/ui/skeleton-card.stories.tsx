import type { Meta, StoryObj } from '@storybook/react'

import { SkeletonCard } from './skeleton'

const meta: Meta<typeof SkeletonCard> = {
  title: 'UI/SkeletonCard',
  component: SkeletonCard,
  tags: ['autodocs'],
}

export default meta

type Story = StoryObj<typeof SkeletonCard>

export const Default: Story = {}

export const InGrid: Story = {
  render: () => (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </div>
  ),
}