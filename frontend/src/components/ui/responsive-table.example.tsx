/**
 * Example: Using ResponsiveTable with sticky first column
 * 
 * This demonstrates how to use the responsive table component
 * for policy and claim tables on mobile devices.
 */

import {
  ResponsiveTable,
  ResponsiveTableTable,
  ResponsiveTableHeader,
  ResponsiveTableBody,
  ResponsiveTableRow,
  ResponsiveTableHead,
  ResponsiveTableCell,
} from '@/components/ui/responsive-table';
import { Badge } from '@/components/ui/badge';

interface Policy {
  id: string;
  status: 'Active' | 'Pending' | 'Expired';
  coverage: string;
  premium: string;
  startDate: string;
  endDate: string;
}

const policies: Policy[] = [
  {
    id: 'POL-001',
    status: 'Active',
    coverage: '10,000 XLM',
    premium: '100 XLM',
    startDate: '2026-01-01',
    endDate: '2027-01-01',
  },
  {
    id: 'POL-002',
    status: 'Pending',
    coverage: '5,000 XLM',
    premium: '50 XLM',
    startDate: '2026-02-01',
    endDate: '2027-02-01',
  },
  {
    id: 'POL-003',
    status: 'Expired',
    coverage: '15,000 XLM',
    premium: '150 XLM',
    startDate: '2025-01-01',
    endDate: '2026-01-01',
  },
];

export function PolicyTableExample() {
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">My Policies</h2>
      
      <ResponsiveTable>
        <ResponsiveTableTable>
          <ResponsiveTableHeader>
            <ResponsiveTableRow>
              {/* First column is sticky */}
              <ResponsiveTableHead sticky>Policy ID</ResponsiveTableHead>
              <ResponsiveTableHead>Status</ResponsiveTableHead>
              <ResponsiveTableHead>Coverage</ResponsiveTableHead>
              <ResponsiveTableHead>Premium</ResponsiveTableHead>
              <ResponsiveTableHead>Start Date</ResponsiveTableHead>
              <ResponsiveTableHead>End Date</ResponsiveTableHead>
            </ResponsiveTableRow>
          </ResponsiveTableHeader>
          <ResponsiveTableBody>
            {policies.map((policy) => (
              <ResponsiveTableRow key={policy.id}>
                {/* First cell is sticky */}
                <ResponsiveTableCell sticky className="font-medium">
                  {policy.id}
                </ResponsiveTableCell>
                <ResponsiveTableCell>
                  <Badge
                    variant={
                      policy.status === 'Active'
                        ? 'default'
                        : policy.status === 'Pending'
                        ? 'secondary'
                        : 'destructive'
                    }
                  >
                    {policy.status}
                  </Badge>
                </ResponsiveTableCell>
                <ResponsiveTableCell>{policy.coverage}</ResponsiveTableCell>
                <ResponsiveTableCell>{policy.premium}</ResponsiveTableCell>
                <ResponsiveTableCell>{policy.startDate}</ResponsiveTableCell>
                <ResponsiveTableCell>{policy.endDate}</ResponsiveTableCell>
              </ResponsiveTableRow>
            ))}
          </ResponsiveTableBody>
        </ResponsiveTableTable>
      </ResponsiveTable>

      <p className="text-sm text-muted-foreground">
        💡 Tip: On mobile, scroll horizontally to see all columns. The Policy ID column stays visible.
      </p>
    </div>
  );
}

// Example without sticky column
export function SimpleTableExample() {
  return (
    <ResponsiveTable stickyFirstColumn={false}>
      <ResponsiveTableTable>
        <ResponsiveTableHeader>
          <ResponsiveTableRow>
            <ResponsiveTableHead>Claim ID</ResponsiveTableHead>
            <ResponsiveTableHead>Amount</ResponsiveTableHead>
            <ResponsiveTableHead>Status</ResponsiveTableHead>
          </ResponsiveTableRow>
        </ResponsiveTableHeader>
        <ResponsiveTableBody>
          <ResponsiveTableRow>
            <ResponsiveTableCell>CLM-001</ResponsiveTableCell>
            <ResponsiveTableCell>1,000 XLM</ResponsiveTableCell>
            <ResponsiveTableCell>Approved</ResponsiveTableCell>
          </ResponsiveTableRow>
        </ResponsiveTableBody>
      </ResponsiveTableTable>
    </ResponsiveTable>
  );
}
