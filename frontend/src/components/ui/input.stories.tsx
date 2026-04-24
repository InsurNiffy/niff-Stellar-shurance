import type { Meta, StoryObj } from '@storybook/react'
import { Input } from './input'

const meta: Meta<typeof Input> = {
  title: 'UI/Input',
  component: Input,
  tags: ['autodocs'],
  argTypes: {
    disabled: { control: 'boolean' },
    placeholder: { control: 'text' },
    type: { control: 'select', options: ['text', 'email', 'password', 'number'] },
  },
}
export default meta
type Story = StoryObj<typeof Input>

export const Default: Story = { args: { placeholder: 'Enter value…' } }
export const WithValue: Story = { args: { defaultValue: 'GXXXXXXXX' } }
export const Disabled: Story = { args: { placeholder: 'Disabled', disabled: true } }
export const Password: Story = { args: { type: 'password', placeholder: 'Password' } }
