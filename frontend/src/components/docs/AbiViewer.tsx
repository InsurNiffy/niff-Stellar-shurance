'use client';

/**
 * AbiViewer
 *
 * Renders the public entrypoint signatures of a Soroban contract in a
 * human-readable format. Each row shows the function name, its parameters
 * with types, and the return type.
 *
 * Usage:
 *   <AbiViewer metadata={niffyInsureAbi} />
 */

import React, { useState } from 'react';

// ---------------------------------------------------------------------------
// ABI type definitions
// ---------------------------------------------------------------------------

export interface AbiParam {
  name: string;
  type: string;
}

export interface AbiFunction {
  name: string;
  params: AbiParam[];
  returnType: string;
  /** Optional short description shown in the expanded row. */
  description?: string;
}

export interface ContractAbiMetadata {
  /** Display name of the contract. */
  contractName: string;
  /** Semantic version string, e.g. "1.0.0". */
  version?: string;
  functions: AbiFunction[];
}

// ---------------------------------------------------------------------------
// Built-in metadata for the niffyinsure contract
// Derived from contracts/niffyinsure/src/lib.rs
// ---------------------------------------------------------------------------

export const niffyInsureAbi: ContractAbiMetadata = {
  contractName: 'niffyinsure',
  version: '1.0.0',
  functions: [
    {
      name: 'initialize',
      params: [
        { name: 'admin', type: 'Address' },
        { name: 'token', type: 'Address' },
      ],
      returnType: 'Result<(), InitError>',
      description: 'One-time initialisation: set the admin address and payment token.',
    },
    {
      name: 'get_admin',
      params: [],
      returnType: 'Address',
      description: 'Return the current admin address.',
    },
    {
      name: 'version',
      params: [],
      returnType: 'String',
      description: 'Return the deployed contract version string.',
    },
    {
      name: 'get_contract_metadata',
      params: [],
      returnType: 'ContractMetadata',
      description: 'Return on-chain metadata (name, version, deploy timestamp).',
    },
    {
      name: 'get_wasm_hash',
      params: [],
      returnType: 'BytesN<32>',
      description: 'Return the SHA-256 hash of the currently installed WASM blob.',
    },
    {
      name: 'get_treasury_balance',
      params: [],
      returnType: 'i128',
      description: 'Return the current treasury balance in the smallest token unit.',
    },
    {
      name: 'get_protocol_fee_bps',
      params: [],
      returnType: 'u32',
      description: 'Return the protocol fee in basis points (1 bps = 0.01 %).',
    },
    {
      name: 'get_fee_recipient',
      params: [],
      returnType: 'Address',
      description: 'Return the address that receives protocol fees.',
    },
    {
      name: 'generate_premium',
      params: [
        { name: 'holder', type: 'Address' },
        { name: 'asset', type: 'Address' },
        { name: 'coverage_amount', type: 'i128' },
        { name: 'duration_days', type: 'u32' },
      ],
      returnType: 'Result<i128, QuoteError>',
      description: 'Calculate the premium for a new policy quote.',
    },
    {
      name: 'file_claim',
      params: [
        { name: 'holder', type: 'Address' },
        { name: 'policy_id', type: 'u64' },
        { name: 'evidence_hash', type: 'BytesN<32>' },
        { name: 'description', type: 'String' },
      ],
      returnType: 'Result<u64, ClaimError>',
      description: 'File a new claim against a policy. Returns the new claim ID.',
    },
    {
      name: 'vote_on_claim',
      params: [
        { name: 'voter', type: 'Address' },
        { name: 'claim_id', type: 'u64' },
        { name: 'vote', type: 'VoteChoice' },
      ],
      returnType: 'Result<(), VoteError>',
      description: 'Cast a governance vote (Approve / Reject) on an open claim.',
    },
    {
      name: 'delegate_vote',
      params: [
        { name: 'delegator', type: 'Address' },
        { name: 'delegate', type: 'Address' },
        { name: 'expires_at', type: 'u64' },
      ],
      returnType: 'Result<(), DelegationError>',
      description: 'Delegate voting power to another address until a ledger timestamp.',
    },
    {
      name: 'finalize_claim',
      params: [{ name: 'claim_id', type: 'u64' }],
      returnType: 'Result<ClaimStatus, ValidateError>',
      description: 'Finalise a claim after the voting period has ended.',
    },
    {
      name: 'withdraw_claim',
      params: [
        { name: 'holder', type: 'Address' },
        { name: 'claim_id', type: 'u64' },
      ],
      returnType: 'Result<(), ClaimError>',
      description: 'Withdraw a pending claim before votes are cast.',
    },
  ],
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface AbiViewerProps {
  metadata: ContractAbiMetadata;
}

function formatSignature(fn: AbiFunction): string {
  const params = fn.params.map((p) => `${p.name}: ${p.type}`).join(', ');
  return `${fn.name}(${params}) → ${fn.returnType}`;
}

export function AbiViewer({ metadata }: AbiViewerProps) {
  const [filter, setFilter] = useState('');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const filtered = metadata.functions.filter((fn) =>
    fn.name.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="my-6">
      <div className="flex items-center justify-between mb-3 gap-4 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-gray-900 mb-0.5">
            {metadata.contractName}
            {metadata.version && (
              <span className="ml-2 text-xs font-normal text-gray-500 font-mono">
                v{metadata.version}
              </span>
            )}
          </h3>
          <p className="text-xs text-gray-500">{filtered.length} entrypoints</p>
        </div>
        <input
          type="search"
          placeholder="Filter functions…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
        />
      </div>

      <div className="rounded-lg border overflow-hidden text-sm">
        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-center text-gray-400 text-sm">
            No functions match &ldquo;{filter}&rdquo;
          </p>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 font-medium">Function</th>
                <th className="px-4 py-2 font-medium hidden sm:table-cell">Parameters</th>
                <th className="px-4 py-2 font-medium hidden md:table-cell">Returns</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((fn) => {
                const isOpen = expandedRow === fn.name;
                return (
                  <React.Fragment key={fn.name}>
                    <tr
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => setExpandedRow(isOpen ? null : fn.name)}
                    >
                      <td className="px-4 py-2.5 font-mono font-semibold text-blue-700">
                        {fn.name}
                        <span
                          className="ml-2 text-xs text-gray-400"
                          aria-hidden="true"
                        >
                          {isOpen ? '▲' : '▼'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 hidden sm:table-cell font-mono text-xs text-gray-600">
                        {fn.params.length === 0 ? (
                          <span className="text-gray-400 italic">none</span>
                        ) : (
                          fn.params.map((p) => (
                            <span key={p.name} className="block">
                              <span className="text-gray-800">{p.name}</span>
                              <span className="text-gray-400">: </span>
                              <span className="text-purple-700">{p.type}</span>
                            </span>
                          ))
                        )}
                      </td>
                      <td className="px-4 py-2.5 hidden md:table-cell font-mono text-xs text-green-700">
                        {fn.returnType}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-gray-50">
                        <td colSpan={3} className="px-4 py-3">
                          {fn.description && (
                            <p className="text-xs text-gray-600 mb-2">{fn.description}</p>
                          )}
                          <pre className="text-xs bg-gray-100 rounded px-3 py-2 overflow-x-auto text-gray-800 font-mono whitespace-pre-wrap">
                            {formatSignature(fn)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
