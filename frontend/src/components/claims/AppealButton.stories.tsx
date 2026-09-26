import type { Meta, StoryObj } from '@storybook/react'
import { AppealButton } from './AppealButton'
import type { Claim } from '@/lib/schemas/vote'

// Minimal rejected claim fixture used across stories
const rejectedClaim: Claim = {
  claim_id: 'CLM-0042',
  policy_id: 'POL-0007',
  claimant: 'GABC1234WALLET567890ABCDEF1234567890ABCDEF1234567890ABCDEF12',
  amount: '500000000',
  details: 'Property damage from storm event on 2026-07-15.',
  evidence: [
    {
      url: 'https://gateway.example.com/ipfs/Qm123abc',
      hash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    },
  ],
  status: 'Rejected',
  voting_deadline_ledger: 900_000,
  approve_votes: 3,
  reject_votes: 7,
  filed_at: 850_000,
  total_voters: 10,
}

const processingClaim: Claim = {
  ...rejectedClaim,
  claim_id: 'CLM-0043',
  status: 'Processing',
}

const CLAIMANT_ADDRESS = rejectedClaim.claimant
const OTHER_ADDRESS = 'GZOTHER789012ABCDEF1234567890ABCDEF1234567890ABCDEF123456789'

const meta: Meta<typeof AppealButton> = {
  title: 'Claims/AppealButton',
  component: AppealButton,
  tags: ['autodocs'],
  argTypes: {
    submitting: { control: 'boolean' },
    walletAddress: { control: 'text' },
  },
  args: {
    claim: rejectedClaim,
    walletAddress: CLAIMANT_ADDRESS,
    submitting: false,
    onClick: () => {},
  },
}
export default meta
type Story = StoryObj<typeof AppealButton>

/**
 * Default — rejected claim, claimant wallet connected. Button is visible and active.
 */
export const Default: Story = {}

/**
 * Submitting — appeal transaction is in flight. Button is disabled with loading label.
 */
export const Submitting: Story = {
  args: {
    submitting: true,
  },
}

/**
 * HiddenWalletNotConnected — wallet is null (not connected). Button renders nothing.
 */
export const HiddenWalletNotConnected: Story = {
  args: {
    walletAddress: null,
  },
}

/**
 * HiddenNonClaimant — connected wallet is NOT the claimant. Button renders nothing.
 */
export const HiddenNonClaimant: Story = {
  args: {
    walletAddress: OTHER_ADDRESS,
  },
}

/**
 * HiddenNotRejected — claim is in Processing status, not Rejected. Button renders nothing.
 */
export const HiddenNotRejected: Story = {
  args: {
    claim: processingClaim,
  },
}
