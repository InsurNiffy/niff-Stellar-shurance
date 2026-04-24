import { Badge, type BadgeProps } from '@/components/ui/badge'

export type InsuranceStatus =
  | 'active'
  | 'expired'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'under_review'

const STATUS_VARIANT: Record<InsuranceStatus, BadgeProps['variant']> = {
  active: 'success',
  approved: 'success',
  pending: 'warning',
  under_review: 'warning',
  expired: 'outline',
  rejected: 'destructive',
}

const STATUS_LABEL: Record<InsuranceStatus, string> = {
  active: 'Active',
  approved: 'Approved',
  pending: 'Pending',
  under_review: 'Under Review',
  expired: 'Expired',
  rejected: 'Rejected',
}

export interface StatusBadgeProps {
  status: InsuranceStatus
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <Badge variant={STATUS_VARIANT[status]} className={className}>
      {STATUS_LABEL[status]}
    </Badge>
  )
}
