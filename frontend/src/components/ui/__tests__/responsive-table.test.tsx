/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import {
  ResponsiveTable,
  ResponsiveTableTable,
  ResponsiveTableHeader,
  ResponsiveTableBody,
  ResponsiveTableRow,
  ResponsiveTableHead,
  ResponsiveTableCell,
} from '../responsive-table';

describe('ResponsiveTable', () => {
  const renderTable = (stickyFirstColumn = true) => {
    return render(
      <ResponsiveTable stickyFirstColumn={stickyFirstColumn}>
        <ResponsiveTableTable>
          <ResponsiveTableHeader>
            <ResponsiveTableRow>
              <ResponsiveTableHead sticky>Policy ID</ResponsiveTableHead>
              <ResponsiveTableHead>Status</ResponsiveTableHead>
              <ResponsiveTableHead>Amount</ResponsiveTableHead>
              <ResponsiveTableHead>Date</ResponsiveTableHead>
            </ResponsiveTableRow>
          </ResponsiveTableHeader>
          <ResponsiveTableBody>
            <ResponsiveTableRow>
              <ResponsiveTableCell sticky>POL-001</ResponsiveTableCell>
              <ResponsiveTableCell>Active</ResponsiveTableCell>
              <ResponsiveTableCell>1000 XLM</ResponsiveTableCell>
              <ResponsiveTableCell>2026-04-26</ResponsiveTableCell>
            </ResponsiveTableRow>
            <ResponsiveTableRow>
              <ResponsiveTableCell sticky>POL-002</ResponsiveTableCell>
              <ResponsiveTableCell>Pending</ResponsiveTableCell>
              <ResponsiveTableCell>500 XLM</ResponsiveTableCell>
              <ResponsiveTableCell>2026-04-25</ResponsiveTableCell>
            </ResponsiveTableRow>
          </ResponsiveTableBody>
        </ResponsiveTableTable>
      </ResponsiveTable>
    );
  };

  it('renders table with correct structure', () => {
    renderTable();

    expect(screen.getByRole('region', { name: /scrollable table/i })).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Policy ID')).toBeInTheDocument();
    expect(screen.getByText('POL-001')).toBeInTheDocument();
  });

  it('applies sticky class to first column cells when stickyFirstColumn is true', () => {
    const { container } = renderTable(true);

    const stickyHeaders = container.querySelectorAll('th.sticky-cell');
    const stickyCells = container.querySelectorAll('td.sticky-cell');

    expect(stickyHeaders.length).toBe(1);
    expect(stickyCells.length).toBe(2);
  });

  it('does not apply sticky class when stickyFirstColumn is false', () => {
    const { container } = renderTable(false);

    const stickyElements = container.querySelectorAll('.sticky-cell');
    expect(stickyElements.length).toBe(0);
  });

  it('has scrollable container with correct ARIA attributes', () => {
    renderTable();

    const scrollContainer = screen.getByRole('region', { name: /scrollable table/i });
    expect(scrollContainer).toHaveAttribute('tabIndex', '0');
  });

  it('maintains table semantics with thead and tbody', () => {
    const { container } = renderTable();

    const thead = container.querySelector('thead');
    const tbody = container.querySelector('tbody');

    expect(thead).toBeInTheDocument();
    expect(tbody).toBeInTheDocument();
  });

  it('renders all column headers correctly', () => {
    renderTable();

    expect(screen.getByText('Policy ID')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Amount')).toBeInTheDocument();
    expect(screen.getByText('Date')).toBeInTheDocument();
  });

  it('renders all table data correctly', () => {
    renderTable();

    expect(screen.getByText('POL-001')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('1000 XLM')).toBeInTheDocument();
    expect(screen.getByText('2026-04-26')).toBeInTheDocument();
  });

  it('applies responsive-table-sticky class when stickyFirstColumn is enabled', () => {
    const { container } = renderTable(true);

    const stickyContainer = container.querySelector('.responsive-table-sticky');
    expect(stickyContainer).toBeInTheDocument();
  });

  it('applies whitespace-nowrap to prevent text wrapping', () => {
    const { container } = renderTable();

    const headers = container.querySelectorAll('th');
    const cells = container.querySelectorAll('td');

    headers.forEach(header => {
      expect(header).toHaveClass('whitespace-nowrap');
    });

    cells.forEach(cell => {
      expect(cell).toHaveClass('whitespace-nowrap');
    });
  });

  it('has overflow-x-auto on scroll container', () => {
    const { container } = renderTable();

    const scrollContainer = container.querySelector('[role="region"]');
    expect(scrollContainer).toHaveClass('overflow-x-auto');
  });

  it('supports custom className on ResponsiveTable', () => {
    const { container } = render(
      <ResponsiveTable className="custom-class">
        <ResponsiveTableTable>
          <ResponsiveTableBody>
            <ResponsiveTableRow>
              <ResponsiveTableCell>Test</ResponsiveTableCell>
            </ResponsiveTableRow>
          </ResponsiveTableBody>
        </ResponsiveTableTable>
      </ResponsiveTable>
    );

    const wrapper = container.firstChild;
    expect(wrapper).toHaveClass('custom-class');
  });

  it('supports custom className on table elements', () => {
    const { container } = render(
      <ResponsiveTable>
        <ResponsiveTableTable className="custom-table">
          <ResponsiveTableHeader className="custom-header">
            <ResponsiveTableRow className="custom-row">
              <ResponsiveTableHead className="custom-head">Header</ResponsiveTableHead>
            </ResponsiveTableRow>
          </ResponsiveTableHeader>
          <ResponsiveTableBody className="custom-body">
            <ResponsiveTableRow>
              <ResponsiveTableCell className="custom-cell">Cell</ResponsiveTableCell>
            </ResponsiveTableRow>
          </ResponsiveTableBody>
        </ResponsiveTableTable>
      </ResponsiveTable>
    );

    expect(container.querySelector('.custom-table')).toBeInTheDocument();
    expect(container.querySelector('.custom-header')).toBeInTheDocument();
    expect(container.querySelector('.custom-row')).toBeInTheDocument();
    expect(container.querySelector('.custom-head')).toBeInTheDocument();
    expect(container.querySelector('.custom-body')).toBeInTheDocument();
    expect(container.querySelector('.custom-cell')).toBeInTheDocument();
  });
});
