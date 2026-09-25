'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export type PolicyStatus = 'active' | 'grace' | 'expired' | 'terminated';
export type PolicyType = 'auto' | 'home' | 'health' | 'travel' | 'life';

export interface PolicyFiltersValue {
  status: PolicyStatus | 'all';
  type: PolicyType | 'all';
  asset: string;
}

export const POLICY_STATUSES: { value: PolicyStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'grace', label: 'Grace' },
  { value: 'expired', label: 'Expired' },
  { value: 'terminated', label: 'Terminated' },
];

export const POLICY_TYPES: { value: PolicyType; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'home', label: 'Home' },
  { value: 'health', label: 'Health' },
  { value: 'travel', label: 'Travel' },
  { value: 'life', label: 'Life' },
];

const STATUS_VALUES = new Set<string>(['all', ...POLICY_STATUSES.map((s) => s.value)]);
const TYPE_VALUES = new Set<string>(['all', ...POLICY_TYPES.map((t) => t.value)]);

/**
 * Reads the current filter state from the URL search params so the list page
 * and the filters stay in sync (and the state is shareable/bookmarkable).
 */
export function readPolicyFilters(searchParams: URLSearchParams): PolicyFiltersValue {
  const status = searchParams.get('status') ?? 'all';
  const type = searchParams.get('type') ?? 'all';
  const asset = searchParams.get('asset') ?? '';

  return {
    status: STATUS_VALUES.has(status) ? (status as PolicyFiltersValue['status']) : 'all',
    type: TYPE_VALUES.has(type) ? (type as PolicyFiltersValue['type']) : 'all',
    asset,
  };
}

interface PolicyFiltersProps {
  value: PolicyFiltersValue;
  assets: string[];
  onChange: (next: PolicyFiltersValue) => void;
}

/**
 * Filter controls for the policies list. Every change is pushed to the URL so
 * the query and the visible list stay in sync.
 */
export default function PolicyFilters({ value, assets, onChange }: PolicyFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const update = useCallback(
    (patch: Partial<PolicyFiltersValue>) => {
      const next: PolicyFiltersValue = { ...value, ...patch };
      onChange(next);

      const params = new URLSearchParams(searchParams?.toString() ?? '');
      if (next.status === 'all') params.delete('status');
      else params.set('status', next.status);
      if (next.type === 'all') params.delete('type');
      else params.set('type', next.type);
      if (!next.asset) params.delete('asset');
      else params.set('asset', next.asset);
      // Any filter change resets pagination to the first page.
      params.delete('cursor');

      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [onChange, pathname, router, searchParams, value],
  );

  const assetOptions = useMemo(() => Array.from(new Set(assets)).sort(), [assets]);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-gray-700">Status</span>
        <select
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
          value={value.status}
          onChange={(event) =>
            update({ status: event.target.value as PolicyFiltersValue['status'] })
          }
        >
          <option value="all">All statuses</option>
          {POLICY_STATUSES.map((status) => (
            <option key={status.value} value={status.value}>
              {status.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-gray-700">Type</span>
        <select
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
          value={value.type}
          onChange={(event) => update({ type: event.target.value as PolicyFiltersValue['type'] })}
        >
          <option value="all">All types</option>
          {POLICY_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-gray-700">Asset</span>
        <select
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
          value={value.asset}
          onChange={(event) => update({ asset: event.target.value })}
        >
          <option value="">All assets</option>
          {assetOptions.map((asset) => (
            <option key={asset} value={asset}>
              {asset}
            </option>
          ))}
        </select>
      </label>

      {(value.status !== 'all' || value.type !== 'all' || value.asset) && (
        <button
          type="button"
          className="self-start rounded-md px-3 py-2 text-sm font-medium text-blue-600 hover:underline sm:self-auto"
          onClick={() => update({ status: 'all', type: 'all', asset: '' })}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
