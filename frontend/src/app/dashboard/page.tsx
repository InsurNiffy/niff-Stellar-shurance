import { PolicyDashboard } from '@/features/policies/components/PolicyDashboard';

export const metadata = { title: 'My Policies' };

export default function PolicyDashboardPage() {
  return (
    <main className="container mx-auto px-4 py-8 max-w-6xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">My Policies</h1>
      <PolicyDashboard />
    </main>
  );
}
