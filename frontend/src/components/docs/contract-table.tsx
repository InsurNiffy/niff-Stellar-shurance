'use client'

import { useState } from 'react'
import { getContracts, type Network } from '@/lib/network-manifest'

export function ContractTable() {
  const [network, setNetwork] = useState<Network>('testnet')
  const contracts = getContracts(network)

  return (
    <div className="my-6">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm font-medium text-gray-700">Network:</span>
        <div className="flex rounded-md border overflow-hidden text-sm">
          {(['testnet', 'public'] as Network[]).map((n) => (
            <button
              key={n}
              onClick={() => setNetwork(n)}
              className={`px-3 py-1.5 transition-colors ${
                network === n
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {n === 'public' ? 'Mainnet' : 'Testnet'}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium text-gray-600">Contract</th>
              <th className="px-4 py-2 font-medium text-gray-600">Contract ID</th>
              <th className="px-4 py-2 font-medium text-gray-600">WASM Hash</th>
              <th className="px-4 py-2 font-medium text-gray-600">Deployed</th>
              <th className="px-4 py-2 font-medium text-gray-600">Explorer</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.name} className="border-t">
                <td className="px-4 py-2 font-mono font-medium">{c.name}</td>
                <td className="px-4 py-2 font-mono text-xs break-all">{c.contractId}</td>
                <td className="px-4 py-2 font-mono text-xs break-all">{c.expectedWasmHash}</td>
                <td className="px-4 py-2 text-xs text-gray-500">
                  {new Date(c.deployedAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-2">
                  <a
                    href={c.stellarExpertUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline text-xs"
                  >
                    Stellar Expert ↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
