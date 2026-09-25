import { useMemo } from 'react';

export type ClaimStatus =
  | 'filed'
  | 'voting'
  | 'finalized'
  | 'appealed'
  | 'paid'
  | 'rejected';

export interface ClaimTimelineEvent {
  id: string;
  label: string;
  timestamp?: string | number | Date | null;
  status?: ClaimStatus;
  detail?: string;
}

export interface ClaimTimelineProps {
  status: ClaimStatus;
  events?: ClaimTimelineEvent[];
  filedAt?: string | number | Date | null;
  votingEndsAt?: string | number | Date | null;
  finalizedAt?: string | number | Date | null;
  appealUntil?: string | number | Date | null;
  paidAt?: string | number | Date | null;
  className?: string;
}

const STAGES: { key: ClaimStatus; label: string }[] = [
  { key: 'filed', label: 'Filed' },
  { key: 'voting', label: 'Votes' },
  { key: 'finalized', label: 'Finalized' },
  { key: 'appealed', label: 'Appeal' },
  { key: 'paid', label: 'Paid' },
];

function toDate(value?: string | number | Date | null): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTimestamp(value?: string | number | Date | null): string | null {
  const date = toDate(value);
  if (!date) return null;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function stageIndex(status: ClaimStatus): number {
  if (status === 'rejected') return STAGES.findIndex((s) => s.key === 'finalized');
  return STAGES.findIndex((s) => s.key === status);
}

/**
 * Renders the claim lifecycle timeline (filed -> votes -> finalized -> appeal -> paid).
 * The order is fixed so tests can assert the sequence regardless of status.
 */
export default function ClaimTimeline({
  status,
  events,
  filedAt,
  votingEndsAt,
  finalizedAt,
  appealUntil,
  paidAt,
  className,
}: ClaimTimelineProps) {
  const timestamps: Record<string, string | number | Date | null | undefined> = {
    filed: filedAt,
    voting: votingEndsAt,
    finalized: finalizedAt,
    appealed: appealUntil,
    paid: paidAt,
  };

  const activeIndex = stageIndex(status);

  const items = useMemo(() => {
    if (events && events.length > 0) {
      return events.map((event) => ({
        id: event.id,
        label: event.label,
        timestamp: formatTimestamp(event.timestamp),
        detail: event.detail,
      }));
    }
    return STAGES.map((stage) => ({
      id: stage.key,
      label: stage.label,
      timestamp: formatTimestamp(timestamps[stage.key]),
      detail: undefined as string | undefined,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, filedAt, votingEndsAt, finalizedAt, appealUntil, paidAt]);

  return (
    <ol
      className={className}
      data-testid="claim-timeline"
      aria-label="Claim timeline"
      style={{ listStyle: 'none', margin: 0, padding: 0 }}
    >
      {items.map((item, index) => {
        const isComplete = events && events.length > 0 ? true : index <= activeIndex;
        const isCurrent = events && events.length > 0 ? index === items.length - 1 : index === activeIndex;
        return (
          <li
            key={item.id}
            data-testid={`claim-timeline-item-${item.id}`}
            data-state={isCurrent ? 'current' : isComplete ? 'complete' : 'pending'}
            style={{ display: 'flex', gap: '0.75rem', paddingBottom: '1rem' }}
          >
            <span
              aria-hidden="true"
              style={{
                flex: '0 0 auto',
                width: '0.75rem',
                height: '0.75rem',
                marginTop: '0.35rem',
                borderRadius: '9999px',
                background: isComplete ? '#16a34a' : '#d1d5db',
                outline: isCurrent ? '3px solid rgba(22,163,74,0.25)' : 'none',
              }}
            />
            <div>
              <div style={{ fontWeight: isCurrent ? 600 : 500 }}>{item.label}</div>
              {item.timestamp ? (
                <time
                  dateTime={toDate(item.timestamp)?.toISOString()}
                  style={{ fontSize: '0.8125rem', color: '#6b7280' }}
                >
                  {item.timestamp}
                </time>
              ) : (
                <span style={{ fontSize: '0.8125rem', color: '#9ca3af' }}>Pending</span>
              )}
              {item.detail ? (
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#4b5563' }}>
                  {item.detail}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
