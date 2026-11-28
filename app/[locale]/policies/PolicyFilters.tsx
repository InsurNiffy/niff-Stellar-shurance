'use client';

import { useTranslations } from 'next-intl';

export type PolicyStatus = 'Active' | 'Expired' | 'Terminated';

export const POLICY_STATUSES: PolicyStatus[] = ['Active', 'Expired', 'Terminated'];

interface PolicyFiltersProps {
  status: PolicyStatus | 'All';
  onChange: (status: PolicyStatus | 'All') => void;
}

export function PolicyFilters({ status, onChange }: PolicyFiltersProps) {
  const t = useTranslations('policies');

  const options: Array<PolicyStatus | 'All'> = ['All', ...POLICY_STATUSES];

  return (
    <div
      role="group"
      aria-label={t('filters.statusLabel')}
      className="flex flex-wrap gap-2"
    >
      {options.map((option) => {
        const isActive = status === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option)}
            className={
              'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ' +
              (isActive
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50')
            }
          >
            {option === 'All' ? t('filters.all') : t(`status.${option.toLowerCase()}`)}
          </button>
        );
      })}
    </div>
  );
}
