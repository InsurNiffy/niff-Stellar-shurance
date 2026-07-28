import { loadMdx } from '@/lib/load-mdx'
import { ClaimVotingDiagram } from './ClaimVotingDiagram'

export const metadata = { title: 'Voting Mechanics — NiffyInsur Docs' }

export default async function VotingPage() {
  const { content } = await loadMdx('voting')
  return (
    <>
      {content}
      <ClaimVotingDiagram />
    </>
  )
}
