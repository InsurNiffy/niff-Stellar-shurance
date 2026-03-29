import { redirect } from 'next/navigation'

/** Canonical policies list lives under `/policies` (segment-level error boundary). */
export default function PolicyDashboardPage() {
  redirect('/policies')
}
