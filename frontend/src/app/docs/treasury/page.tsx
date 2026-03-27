import { loadMdx } from '@/lib/load-mdx'

export const metadata = { title: 'Treasury & Pause — NiffyInsur Docs' }

export default async function TreasuryPage() {
  const { content } = await loadMdx('treasury')
  return <>{content}</>
}
