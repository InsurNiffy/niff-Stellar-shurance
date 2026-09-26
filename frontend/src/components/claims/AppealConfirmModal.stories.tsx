import type { Meta, StoryObj } from '@storybook/react'
import { AppealConfirmModal } from './AppealConfirmModal'
import type { Claim } from '@/lib/schemas/vote'

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

const meta: Meta<typeof AppealConfirmModal> = {
  title: 'Claims/AppealConfirmModal',
  component: AppealConfirmModal,
  tags: ['autodocs'],
  parameters: {
    // Open the dialog in a full-page decorator so it renders visibly in Storybook
    layout: 'centered',
  },
  argTypes: {
    open: { control: 'boolean' },
    submitting: { control: 'boolean' },
  },
  args: {
    open: true,
    claim: rejectedClaim,
    submitting: false,
    onConfirm: (_notifyOnOutcome: boolean) => {},
    onCancel: () => {},
  },
}
export default meta
type Story = StoryObj<typeof AppealConfirmModal>

/**
 * Default — modal is open, idle state. User sees claim details and appeal rules.
 */
export const Default: Story = {}

/**
 * Submitting — appeal is being signed / submitted. Both buttons disabled; confirm shows spinner label.
 */
export const Submitting: Story = {
  args: {
    submitting: true,
  },
}

/**
 * Closed — modal is not open. Renders nothing (null).
 */
export const Closed: Story = {
  args: {
    open: false,
  },
}

/**
 * NoClaim — claim prop is null. Component short-circuits and renders nothing.
 */
export const NoClaim: Story = {
  args: {
    claim: null,
  },
}

/**
 * ErrorRecovery — simulate the post-error idle state: modal is re-opened after
 * a failed appeal attempt. In production the parent resets submitting=false and
 * keeps the modal open so the user can retry.
 */
export const ErrorRecovery: Story = {
  args: {
    open: true,
    submitting: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          'After a failed appeal attempt, the modal returns to the idle state so the claimant can retry. The parent component surfaces the error message separately (e.g. a toast) and resets submitting to false.',
      },
    },
  },
}
