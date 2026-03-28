'use client';

/**
 * useOptimisticPolicies
 *
 * Wraps usePolicies with optimistic update support for policy initiation.
 *
 * After a transaction is submitted the hook:
 *   1. Immediately marks the policy row as "pending".
 *   2. Polls the backend with exponential backoff until the indexer confirms.
 *   3. Rolls back (restores previous state + shows error) on timeout or failure.
 *
 * Optimistic state lives only in React state — it is never persisted to
 * storage and is cleared on page reload.
 */

import { useCallback, useEffect } from 'react';
import { getConfig } from '@/config/env';
import { useOptimisticState, useConfirmationPoller } from '@/lib/optimistic';
import { usePolicies } from './usePolicies';
import type { UsePoliciesReturn } from './usePolicies';
import type { PolicyDto, PolicyStatusFilter, PolicySortField } from '../api';

// ---------------------------------------------------------------------------
// Confirmation check — asks the backend if the policy is now active/updated.
// ---------------------------------------------------------------------------

async function checkPolicyConfirmed(
  holder: string,
  policyId: number,
  signal: AbortSignal,
): Promise<boolean> {
  const { apiUrl } = getConfig();
  const res = await fetch(
    `${apiUrl}/api/policies/${encodeURIComponent(holder)}/${policyId}`,
    { signal, cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { is_active?: boolean };
  return data.is_active === true;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseOptimisticPoliciesReturn extends UsePoliciesReturn {
  /** Optimistically mark a policy as pending after transaction submission. */
  applyOptimisticPolicy: (policy: PolicyDto, txHash?: string) => void;
  /** Merge optimistic state into the policy list for rendering. */
  mergedPolicies: PolicyDto[];
  /** Raw optimistic entries map (for rendering pollers). */
  entries: ReturnType<typeof useOptimisticState<PolicyDto>>['entries'];
  confirm: (key: string) => void;
  rollback: (key: string, error: string) => void;
}

export function useOptimisticPolicies(
  holder: string | null,
  network: string,
  status: PolicyStatusFilter,
  sort: PolicySortField,
): UseOptimisticPoliciesReturn {
  const base = usePolicies(holder, network, status, sort);
  const optimistic = useOptimisticState<PolicyDto>();

  // When the server list refreshes, confirm or clean up any matching entries.
  useEffect(() => {
    optimistic.entries.forEach((entry, key) => {
      if (entry.status !== 'pending') return;
      const serverPolicy = base.policies.find(
        (p) => String(p.policy_id) === key,
      );
      // If the server now returns the policy as active, confirm it.
      if (serverPolicy?.is_active) {
        optimistic.confirm(key);
        // Remove after a short delay so the "Confirmed" badge is briefly visible.
        setTimeout(() => optimistic.remove(key), 2_000);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base.policies]);

  const applyOptimisticPolicy = useCallback(
    (policy: PolicyDto, txHash?: string) => {
      const key = String(policy.policy_id);
      const optimisticVersion: PolicyDto = { ...policy, is_active: true };
      optimistic.apply(key, 'policy_initiation', optimisticVersion, policy, txHash);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Merge server list with optimistic entries for rendering.
  const mergedPolicies: PolicyDto[] = base.policies.map((p) => {
    const entry = optimistic.get(String(p.policy_id));
    if (!entry || entry.status === 'confirmed') return p;
    return entry.status === 'failed' ? entry.previousData : entry.optimisticData;
  });

  return {
    ...base,
    applyOptimisticPolicy,
    mergedPolicies,
    entries: optimistic.entries,
    confirm: optimistic.confirm,
    rollback: optimistic.rollback,
  };
}

// ---------------------------------------------------------------------------
// Per-entry poller component (rendered by PolicyDashboard per pending entry)
// ---------------------------------------------------------------------------

export interface PolicyConfirmationPollerProps {
  holder: string;
  policyId: number;
  createdAt: number;
  enabled: boolean;
  onConfirmed: (key: string) => void;
  onRollback: (key: string, error: string) => void;
}

/**
 * Headless component — mounts a confirmation poller for a single policy entry.
 * Returns null; side-effects only.
 */
export function PolicyConfirmationPoller({
  holder,
  policyId,
  createdAt,
  enabled,
  onConfirmed,
  onRollback,
}: PolicyConfirmationPollerProps) {
  useConfirmationPoller({
    key: String(policyId),
    enabled,
    createdAt,
    check: (signal) => checkPolicyConfirmed(holder, policyId, signal),
    onConfirmed,
    onRollback,
  });
  return null;
}
