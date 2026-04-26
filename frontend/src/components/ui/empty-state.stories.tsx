import type { Meta, StoryObj } from '@storybook/react'
import { EmptyState } from './empty-state'

const meta: Meta<typeof EmptyState> = {
  title: 'UI/EmptyState',
  component: EmptyState,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof EmptyState>

export const PoliciesEmpty: Story = {
  args: {
    variant: 'policies',
    headline: 'No policies yet',
    description: 'Get started by purchasing your first insurance policy.',
    ctaLabel: 'Purchase Policy',
    ctaHref: '/policy',
  },
}

export const ClaimsEmpty: Story = {
  args: {
    variant: 'claims',
    headline: 'No claims filed',
    description: 'When you file a claim, it will appear here for community voting.',
    ctaLabel: 'File a Claim',
    ctaHref: '/claims/new',
  },
}

export const TransactionsEmpty: Story = {
  args: {
    variant: 'transactions',
    headline: 'No transactions yet',
    description: 'Your transaction history will appear here once you purchase a policy or file a claim.',
    ctaLabel: 'Purchase Policy',
    ctaHref: '/policy',
  },
}

export const WithSecondaryAction: Story = {
  args: {
    variant: 'policies',
    headline: 'No active policies',
    description: 'All your policies have expired or been terminated.',
    ctaLabel: 'Purchase New Policy',
    ctaHref: '/policy',
    secondaryLabel: 'View expired policies',
    onSecondaryClick: () => alert('Navigate to expired policies'),
  },
}

export const WithoutCTA: Story = {
  args: {
    variant: 'claims',
    headline: 'No claims match your filter',
    description: 'Try adjusting your filters to see more results.',
  },
}

export const ReducedMotion: Story = {
  args: {
    variant: 'policies',
    headline: 'No policies yet',
    description: 'Get started by purchasing your first insurance policy.',
    ctaLabel: 'Purchase Policy',
    ctaHref: '/policy',
  },
  parameters: {
    docs: {
      description: {
        story: 'Animations respect prefers-reduced-motion. Set your OS to reduced motion to test.',
      },
    },
  },
}
