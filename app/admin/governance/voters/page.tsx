'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminRoleGuard from '@/components/admin/AdminRoleGuard';

interface Voter {
  address: string;
  label?: string;
  weight: number;
  active: boolean;
}

const ADDRESS_PATTERN = /^G[A-Z2-7]{55}$/;

export default function VotersPage() {
  const [voters, setVoters] = useState<Voter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const [weight, setWeight] = useState('1');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const loadVoters = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/governance/voters', { credentials: 'include' });
      if (!res.ok) throw new Error(`Failed to load voters (${res.status})`);
      const data = (await res.json()) as { voters?: Voter[] };
      setVoters(Array.isArray(data.voters) ? data.voters : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load voters');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadVoters();
  }, [loadVoters]);

  const validate = useCallback((): string | null => {
    const trimmed = address.trim().toUpperCase();
    if (!trimmed) return 'Voter address is required.';
    if (!ADDRESS_PATTERN.test(trimmed)) return 'Address must be a valid Stellar public key.';
    if (voters.some((v) => v.address.toUpperCase() === trimmed)) return 'Voter is already registered.';
    const parsedWeight = Number(weight);
    if (!Number.isFinite(parsedWeight) || parsedWeight <= 0) return 'Weight must be a positive number.';
    return null;
  }, [address, weight, voters]);

  const handleAdd = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const validationError = validate();
      if (validationError) {
        setFormError(validationError);
        return;
      }
      setFormError(null);
      setSubmitting(true);
      try {
        const res = await fetch('/api/admin/governance/voters', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address: address.trim().toUpperCase(),
            label: label.trim() || undefined,
            weight: Number(weight),
          }),
        });
        if (!res.ok) throw new Error(`Failed to add voter (${res.status})`);
        setAddress('');
        setLabel('');
        setWeight('1');
        await loadVoters();
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'Failed to add voter');
      } finally {
        setSubmitting(false);
      }
    },
    [address, label, weight, validate, loadVoters],
  );

  const handleRemove = useCallback(
    async (voterAddress: string) => {
      setRemoving(voterAddress);
      setError(null);
      try {
        const res = await fetch(
          `/api/admin/governance/voters/${encodeURIComponent(voterAddress)}`,
          { method: 'DELETE', credentials: 'include' },
        );
        if (!res.ok) throw new Error(`Failed to remove voter (${res.status})`);
        setVoters((prev) => prev.filter((v) => v.address !== voterAddress));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to remove voter');
      } finally {
        setRemoving(null);
      }
    },
    [],
  );

  const totalWeight = useMemo(
    () => voters.reduce((sum, v) => sum + (v.active ? v.weight : 0), 0),
    [voters],
  );

  return (
    <AdminRoleGuard>
      <div className="mx-auto max-w-5xl space-y-8 p-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Voter Registry</h1>
          <p className="text-sm text-gray-500">
            Manage the addresses allowed to vote on governance proposals.
          </p>
        </header>

        <form
          onSubmit={handleAdd}
          className="space-y-4 rounded-lg border border-gray-200 p-4"
          noValidate
        >
          <h2 className="text-lg font-medium">Add voter</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="font-medium">Address</span>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="G..."
                className="rounded border border-gray-300 px-3 py-2 font-mono text-sm"
                aria-invalid={Boolean(formError)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Weight</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                className="rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-3">
              <span className="font-medium">Label (optional)</span>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
          </div>
          {formError ? (
            <p role="alert" className="text-sm text-red-600">
              {formError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? 'Adding…' : 'Add voter'}
          </button>
        </form>

        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Registered voters</h2>
            <span className="text-sm text-gray-500">
              {voters.length} voter{voters.length === 1 ? '' : 's'} · total weight {totalWeight}
            </span>
          </div>

          {loading ? (
            <p className="text-sm text-gray-500">Loading voters…</p>
          ) : voters.length === 0 ? (
            <p className="text-sm text-gray-500">No voters registered yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Address</th>
                    <th className="px-4 py-2 text-left font-medium">Label</th>
                    <th className="px-4 py-2 text-right font-medium">Weight</th>
                    <th className="px-4 py-2 text-left font-medium">Status</th>
                    <th className="px-4 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {voters.map((voter) => (
                    <tr key={voter.address}>
                      <td className="px-4 py-2 font-mono text-xs">{voter.address}</td>
                      <td className="px-4 py-2">{voter.label ?? '—'}</td>
                      <td className="px-4 py-2 text-right">{voter.weight}</td>
                      <td className="px-4 py-2">
                        <span
                          className={
                            voter.active
                              ? 'rounded bg-green-100 px-2 py-0.5 text-xs text-green-700'
                              : 'rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600'
                          }
                        >
                          {voter.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => void handleRemove(voter.address)}
                          disabled={removing === voter.address}
                          className="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-600 disabled:opacity-50"
                        >
                          {removing === voter.address ? 'Removing…' : 'Remove'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AdminRoleGuard>
  );
}
