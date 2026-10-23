import type { Meta, StoryObj } from '@storybook/react'
import { VoterRegistry } from './VoterRegistry'

const noop = async () => {}

const meta: Meta<typeof VoterRegistry> = {
  title: 'Admin/VoterRegistry',
  component: VoterRegistry,
  tags: ['autodocs'],
  args: { onRegister: noop, onRemove: noop },
}
export default meta
type Story = StoryObj<typeof VoterRegistry>

export const WithVoters: Story = {
  args: {
    voters: [
      {
        walletAddress: 'GDVOEGATQV4FGUJKDEBEYT5NAPWJ55MEMJVLC5TU7Y74WD73PPAS4TYW',
        registeredBy: 'GADMIN',
        registeredAt: '2026-09-01T12:00:00Z',
      },
      {
        walletAddress: 'GBPLT5ZYZFLPVJFU7NZ7TCS6QH4KK3PRIQY2F6V2OCP3B6V6V3F3YH4Q',
        registeredBy: 'GADMIN',
        registeredAt: '2026-10-15T08:30:00Z',
      },
    ],
  },
}
export const Empty: Story = { args: { voters: [] } }
export const Loading: Story = { args: { voters: [], loading: true } }
export const LoadError: Story = { args: { voters: [], error: 'Failed to load voters' } }
