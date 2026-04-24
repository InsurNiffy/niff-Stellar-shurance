import type { Meta, StoryObj } from '@storybook/react'
import { SkeletonRow } from './skeleton'

const meta: Meta<typeof SkeletonRow> = {
  title: 'UI/SkeletonRow',
  component: SkeletonRow,
  tags: ['autodocs'],
}
export default meta
type Story = StoryObj<typeof SkeletonRow>

export const Default: Story = {}

export const InTable: Story = {
  render: () => (
    <div className="rounded-md border divide-y">
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </div>
  ),
}
