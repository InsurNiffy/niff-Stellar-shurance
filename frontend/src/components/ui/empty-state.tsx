'use client'

import { useReducedMotion } from '@/lib/hooks/use-reduced-motion'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// SVG illustrations — inline, aria-hidden, reduced-motion safe
// ---------------------------------------------------------------------------

function PoliciesIllustration({ animated }: { animated: boolean }) {
  return (
    <svg
      width="120"
      height="96"
      viewBox="0 0 120 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn(animated && 'motion-safe:animate-[float_3s_ease-in-out_infinite]')}
    >
      <rect x="20" y="16" width="80" height="64" rx="6" fill="#EFF6FF" stroke="#BFDBFE" strokeWidth="2" />
      <rect x="30" y="28" width="40" height="4" rx="2" fill="#93C5FD" />
      <rect x="30" y="38" width="60" height="3" rx="1.5" fill="#BFDBFE" />
      <rect x="30" y="46" width="50" height="3" rx="1.5" fill="#BFDBFE" />
      <rect x="30" y="54" width="55" height="3" rx="1.5" fill="#BFDBFE" />
      <circle cx="88" cy="72" r="14" fill="#3B82F6" />
      <path d="M82 72l4 4 8-8" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ClaimsIllustration({ animated }: { animated: boolean }) {
  return (
    <svg
      width="120"
      height="96"
      viewBox="0 0 120 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn(animated && 'motion-safe:animate-[float_3s_ease-in-out_infinite]')}
    >
      <rect x="16" y="12" width="88" height="72" rx="6" fill="#F0FDF4" stroke="#BBF7D0" strokeWidth="2" />
      <rect x="28" y="24" width="36" height="4" rx="2" fill="#86EFAC" />
      <rect x="28" y="34" width="64" height="3" rx="1.5" fill="#BBF7D0" />
      <rect x="28" y="42" width="52" height="3" rx="1.5" fill="#BBF7D0" />
      <rect x="28" y="50" width="58" height="3" rx="1.5" fill="#BBF7D0" />
      <rect x="28" y="62" width="20" height="8" rx="4" fill="#22C55E" />
      <rect x="54" y="62" width="20" height="8" rx="4" fill="#FCA5A5" />
    </svg>
  )
}

function TransactionIllustration({ animated }: { animated: boolean }) {
  return (
    <svg
      width="120"
      height="96"
      viewBox="0 0 120 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn(animated && 'motion-safe:animate-[float_3s_ease-in-out_infinite]')}
    >
      <rect x="16" y="20" width="88" height="16" rx="4" fill="#F5F3FF" stroke="#DDD6FE" strokeWidth="2" />
      <rect x="16" y="42" width="88" height="16" rx="4" fill="#F5F3FF" stroke="#DDD6FE" strokeWidth="2" />
      <rect x="16" y="64" width="88" height="16" rx="4" fill="#F5F3FF" stroke="#DDD6FE" strokeWidth="2" />
      <circle cx="28" cy="28" r="4" fill="#A78BFA" />
      <rect x="38" y="25" width="30" height="3" rx="1.5" fill="#C4B5FD" />
      <rect x="74" y="25" width="20" height="3" rx="1.5" fill="#DDD6FE" />
      <circle cx="28" cy="50" r="4" fill="#A78BFA" />
      <rect x="38" y="47" width="24" height="3" rx="1.5" fill="#C4B5FD" />
      <rect x="74" y="47" width="20" height="3" rx="1.5" fill="#DDD6FE" />
      <circle cx="28" cy="72" r="4" fill="#A78BFA" />
      <rect x="38" y="69" width="36" height="3" rx="1.5" fill="#C4B5FD" />
      <rect x="74" y="69" width="20" height="3" rx="1.5" fill="#DDD6FE" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Generic EmptyState component
// ---------------------------------------------------------------------------

export interface EmptyStateProps {
  /** SVG illustration variant */
  variant: 'policies' | 'claims' | 'transactions'
  headline: string
  description: string
  /** Primary CTA label */
  ctaLabel?: string
  /** Primary CTA href */
  ctaHref?: string
  /** Optional secondary action */
  secondaryLabel?: string
  onSecondaryClick?: () => void
  className?: string
}

const ILLUSTRATIONS = {
  policies: PoliciesIllustration,
  claims: ClaimsIllustration,
  transactions: TransactionIllustration,
}

export function EmptyState({
  variant,
  headline,
  description,
  ctaLabel,
  ctaHref,
  secondaryLabel,
  onSecondaryClick,
  className,
}: EmptyStateProps) {
  const prefersReducedMotion = useReducedMotion()
  const Illustration = ILLUSTRATIONS[variant]

  return (
    <div
      role="status"
      className={cn(
        'flex flex-col items-center justify-center py-16 text-center gap-4',
        className,
      )}
    >
      <Illustration animated={!prefersReducedMotion} />

      <div className="space-y-1 max-w-xs">
        <h2 className="text-base font-semibold text-gray-900">{headline}</h2>
        <p className="text-sm text-gray-500">{description}</p>
      </div>

      {ctaLabel && ctaHref && (
        <a
          href={ctaHref}
          className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
        >
          {ctaLabel}
        </a>
      )}

      {secondaryLabel && onSecondaryClick && (
        <button
          type="button"
          onClick={onSecondaryClick}
          className="text-sm text-gray-500 underline underline-offset-2 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
        >
          {secondaryLabel}
        </button>
      )}
    </div>
  )
}
