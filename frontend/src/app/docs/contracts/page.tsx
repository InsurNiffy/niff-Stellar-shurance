import { loadMdx } from '@/lib/load-mdx'
import { ContractTable } from '@/components/docs/contract-table'

export const metadata = { title: 'Contract Addresses — NiffyInsur Docs' }

export default async function ContractsPage() {
  const { content } = await loadMdx('contracts')
  return (
    <>
      {content}
      <ContractTable />
    </>
  )
}
