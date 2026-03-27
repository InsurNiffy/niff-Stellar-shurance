import { loadMdx } from '@/lib/load-mdx'

export const metadata = { title: 'Claim Timelines — NiffyInsur Docs' }

export default async function ClaimsPage() {
  const { content } = await loadMdx('claims')
  return <>{content}</>
}
