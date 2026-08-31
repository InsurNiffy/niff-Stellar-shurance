import type { Meta, StoryObj } from '@storybook/react'

import { PaginationControls } from './PaginationControls'

const meta: Meta<typeof PaginationControls> = {
  title: 'Claims/PaginationControls',
  component: PaginationControls,
  tags: ['autodocs'],
  args: {
    page: 3,
    totalPages: 10,
    onPageChange: () => {},
  },
}
export default meta
type Story = StoryObj<typeof PaginationControls>

export const Middle: Story = { args: { page: 3, totalPages: 10 } }
export const FirstPage: Story = { args: { page: 1, totalPages: 10 } }
export const LastPage: Story = { args: { page: 10, totalPages: 10 } }
export const SinglePage: Story = { args: { page: 1, totalPages: 1 } }
