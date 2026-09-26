import { ContractTable } from '@/components/docs/contract-table'
import { DocsFreshnessBanner } from '@/components/docs/DocsFreshnessBanner'
import { AbiViewer, niffyInsureAbi } from '@/components/docs/AbiViewer'
import { loadMdx } from '@/lib/load-mdx'
import { getContracts } from '@/lib/network-manifest'

export const metadata = { title: 'Contract Addresses — NiffyInsur Docs' }

/**
 * The date this docs page was last reviewed / updated.
 * Update this constant whenever the page content is edited so the freshness
 * banner accurately reflects the staleness window.
 */
const DOCS_LAST_UPDATED = '2025-01-15'

export default async function ContractsPage() {
  const { content } = await loadMdx('contracts')

  // Derive the most recent deploy date from the registry (prefer mainnet).
  const mainnetContracts = getContracts('mainnet')
  const testnetContracts = getContracts('testnet')
  const allContracts = [...mainnetContracts, ...testnetContracts]
  const latestDeployedAt = allContracts
    .map((c) => c.deployedAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null

  return (
    <>
      <DocsFreshnessBanner
        lastUpdated={DOCS_LAST_UPDATED}
        lastDeployedAt={latestDeployedAt}
      />
      {content}
      <ContractTable />

      <h2 className="text-xl font-semibold mt-10 mb-2">Contract ABI</h2>
      <p className="text-sm text-gray-600 mb-4">
        Public entrypoint signatures for the <code>niffyinsure</code> contract.
        Click a row to expand the full signature and description.
      </p>
      <AbiViewer metadata={niffyInsureAbi} />
    </>
  )
}
