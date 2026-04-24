import type { Meta, StoryObj } from '@storybook/react'
import { WalletAddress } from './wallet-address'

// Static mock addresses — no live wallet required
const TESTNET_ADDR = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
const MAINNET_ADDR = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6'

const meta: Meta<typeof WalletAddress> = {
  title: 'UI/WalletAddress',
  component: WalletAddress,
  tags: ['autodocs'],
  argTypes: {
    network: { control: 'radio', options: ['testnet', 'public'] },
    showCopy: { control: 'boolean' },
    showExplorer: { control: 'boolean' },
  },
}
export default meta
type Story = StoryObj<typeof WalletAddress>

export const Testnet: Story = { args: { address: TESTNET_ADDR, network: 'testnet' } }
export const Mainnet: Story = { args: { address: MAINNET_ADDR, network: 'public' } }
export const CopyOnly: Story = { args: { address: TESTNET_ADDR, showExplorer: false } }
export const ExplorerOnly: Story = { args: { address: TESTNET_ADDR, showCopy: false } }
export const NoActions: Story = { args: { address: TESTNET_ADDR, showCopy: false, showExplorer: false } }
export const InvalidAddress: Story = { args: { address: 'not-a-stellar-address' } }
