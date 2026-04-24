import type { Meta, StoryObj } from '@storybook/react'

import { SkeletonDetail } from './skeleton'

const meta: Meta<typeof SkeletonDetail> = {
  title: 'UI/SkeletonDetail',
  component: SkeletonDetail,
  tags: ['autodocs'],
}

export default meta

type Story = StoryObj<typeof SkeletonDetail>

export const Default: Story = {}