import { redirect } from 'next/navigation'

/** Entry point for governance — proposals and community discussion live under /governance/proposals. */
export default function GovernancePage() {
  redirect('/governance/proposals')
}
