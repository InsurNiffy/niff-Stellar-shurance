import type { Meta, StoryObj } from '@storybook/react'
import { Button } from './button'

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'],
    },
    size: { control: 'select', options: ['default', 'sm', 'lg', 'icon'] },
    disabled: { control: 'boolean' },
  },
}
export default meta
type Story = StoryObj<typeof Button>

export const Default: Story = { args: { children: 'Button' } }
export const Destructive: Story = { args: { children: 'Delete', variant: 'destructive' } }
export const Outline: Story = { args: { children: 'Outline', variant: 'outline' } }
export const Ghost: Story = { args: { children: 'Ghost', variant: 'ghost' } }
export const Disabled: Story = { args: { children: 'Disabled', disabled: true } }
export const Small: Story = { args: { children: 'Small', size: 'sm' } }
export const Large: Story = { args: { children: 'Large', size: 'lg' } }
