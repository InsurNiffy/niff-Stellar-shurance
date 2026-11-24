'use client';

import { useEffect, useState } from 'react';
import AdminRoleGuard from '@/components/admin/AdminRoleGuard';

interface GovernanceConfig {
  quorumPercent: number;
  votingDurationHours: number;
  proposalFee: number;
  executionFee: number;
}

const DEFAULT_CONFIG: GovernanceConfig = {
  quorumPercent: 51,
  votingDurationHours: 72,
  proposalFee: 10,
  executionFee: 5,
};

type FieldErrors = Partial<Record<keyof GovernanceConfig, string>>;

function validate(config: GovernanceConfig): FieldErrors {
  const errors: FieldErrors = {};

  if (!Number.isFinite(config.quorumPercent) || config.quorumPercent <= 0 || config.quorumPercent > 100) {
    errors.quorumPercent = 'Quorum must be between 0 and 100.';
  }
  if (!Number.isFinite(config.votingDurationHours) || config.votingDurationHours < 1 || config.votingDurationHours > 720) {
    errors.votingDurationHours = 'Voting duration must be between 1 and 720 hours.';
  }
  if (!Number.isFinite(config.proposalFee) || config.proposalFee < 0) {
    errors.proposalFee = 'Proposal fee cannot be negative.';
  }
  if (!Number.isFinite(config.executionFee) || config.executionFee < 0) {
    errors.executionFee = 'Execution fee cannot be negative.';
  }

  return errors;
}

export default function GovernanceConfigPage() {
  const [config, setConfig] = useState<GovernanceConfig>(DEFAULT_CONFIG);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch('/api/admin/governance/config');
        if (!res.ok) throw new Error('Failed to load governance config');
        const data = (await res.json()) as Partial<GovernanceConfig>;
        if (!cancelled) {
          setConfig({ ...DEFAULT_CONFIG, ...data });
        }
      } catch (err) {
        if (!cancelled) {
          setMessage(err instanceof Error ? err.message : 'Failed to load governance config');
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  function updateField<K extends keyof GovernanceConfig>(key: K, value: string) {
    const parsed = value === '' ? NaN : Number(value);
    setConfig((prev) => ({ ...prev, [key]: parsed }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    setStatus('idle');
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate(config);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      setStatus('error');
      setMessage('Please fix the highlighted fields before submitting.');
      return;
    }

    setStatus('saving');
    setMessage(null);

    try {
      const res = await fetch('/api/admin/governance/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error('Failed to save governance config');
      setStatus('saved');
      setMessage('Governance configuration saved.');
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'Failed to save governance config');
    }
  }

  return (
    <AdminRoleGuard>
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-2xl font-semibold">Governance Configuration</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage quorum, voting duration, and fee parameters for protocol governance.
        </p>

        <form className="mt-6 space-y-6" onSubmit={handleSubmit} noValidate>
          <fieldset className="space-y-4">
            <legend className="text-lg font-medium">Voting</legend>

            <div>
              <label htmlFor="quorumPercent" className="block text-sm font-medium">
                Quorum (%)
              </label>
              <input
                id="quorumPercent"
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={Number.isFinite(config.quorumPercent) ? config.quorumPercent : ''}
                onChange={(e) => updateField('quorumPercent', e.target.value)}
                aria-invalid={Boolean(errors.quorumPercent)}
                className="mt-1 w-full rounded border px-3 py-2"
              />
              {errors.quorumPercent && (
                <p className="mt-1 text-sm text-red-600">{errors.quorumPercent}</p>
              )}
            </div>

            <div>
              <label htmlFor="votingDurationHours" className="block text-sm font-medium">
                Voting duration (hours)
              </label>
              <input
                id="votingDurationHours"
                type="number"
                min={1}
                max={720}
                step="1"
                value={Number.isFinite(config.votingDurationHours) ? config.votingDurationHours : ''}
                onChange={(e) => updateField('votingDurationHours', e.target.value)}
                aria-invalid={Boolean(errors.votingDurationHours)}
                className="mt-1 w-full rounded border px-3 py-2"
              />
              {errors.votingDurationHours && (
                <p className="mt-1 text-sm text-red-600">{errors.votingDurationHours}</p>
              )}
            </div>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="text-lg font-medium">Fees</legend>

            <div>
              <label htmlFor="proposalFee" className="block text-sm font-medium">
                Proposal fee
              </label>
              <input
                id="proposalFee"
                type="number"
                min={0}
                step="0.01"
                value={Number.isFinite(config.proposalFee) ? config.proposalFee : ''}
                onChange={(e) => updateField('proposalFee', e.target.value)}
                aria-invalid={Boolean(errors.proposalFee)}
                className="mt-1 w-full rounded border px-3 py-2"
              />
              {errors.proposalFee && (
                <p className="mt-1 text-sm text-red-600">{errors.proposalFee}</p>
              )}
            </div>

            <div>
              <label htmlFor="executionFee" className="block text-sm font-medium">
                Execution fee
              </label>
              <input
                id="executionFee"
                type="number"
                min={0}
                step="0.01"
                value={Number.isFinite(config.executionFee) ? config.executionFee : ''}
                onChange={(e) => updateField('executionFee', e.target.value)}
                aria-invalid={Boolean(errors.executionFee)}
                className="mt-1 w-full rounded border px-3 py-2"
              />
              {errors.executionFee && (
                <p className="mt-1 text-sm text-red-600">{errors.executionFee}</p>
              )}
            </div>
          </fieldset>

          {message && (
            <p
              role="status"
              className={status === 'error' ? 'text-sm text-red-600' : 'text-sm text-green-600'}
            >
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={status === 'saving'}
            className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
          >
            {status === 'saving' ? 'Saving…' : 'Save configuration'}
          </button>
        </form>
      </main>
    </AdminRoleGuard>
  );
}
