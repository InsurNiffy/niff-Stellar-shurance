import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReviewStep, type PolicyCoverageDetails } from '../steps/ReviewStep';

describe('ReviewStep', () => {
  const mockOnEdit = jest.fn();

  const mockData = {
    amount: '1000',
    details: 'This is a test claim narrative documenting the incident.',
    evidence: [
      {
        url: 'ipfs://QmYwAPJzv5CZsnA625s3Xf2SmxWeN4A7h...',
        contentSha256Hex:
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
      {
        url: 'https://example.com/long-file-name-that-should-be-truncated-in-ui.jpg',
        contentSha256Hex:
          '01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b',
      },
    ],
  };

  const mockPolicyCoverage: PolicyCoverageDetails = {
    coverageAmount: 50000000,
    currency: 'XLM',
    status: 'ACTIVE',
    expiresAt: '2027-01-01T00:00:00.000Z',
  };

  const policyId = '12345';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders all claim data correctly', () => {
    render(<ReviewStep data={mockData} policyId={policyId} />);

    // Check amount
    expect(screen.getByText(/1000 stroops/i)).toBeInTheDocument();

    // Check policy ID
    expect(screen.getByText('Policy ID: #12345')).toBeInTheDocument();

    // Check narrative
    expect(
      screen.getByText('This is a test claim narrative documenting the incident.')
    ).toBeInTheDocument();

    // Check evidence count
    expect(screen.getByText('Evidence (2 files)')).toBeInTheDocument();

    // Check evidence items
    expect(screen.getByText('QmYwAPJzv5CZsnA625s3Xf2SmxWeN4A7h...')).toBeInTheDocument();
    expect(
      screen.getByText('long-file-name-that-should-be-truncated-in-ui.jpg')
    ).toBeInTheDocument();

    // Check hashes (first and last parts)
    expect(screen.getByText('e3b0c44298fc1c14...7852b855')).toBeInTheDocument();
    expect(screen.getByText('01ba4719c80b6fe9...daca546b')).toBeInTheDocument();
  });

  it('renders policy coverage details when provided', () => {
    render(
      <ReviewStep data={mockData} policyId={policyId} policyCoverage={mockPolicyCoverage} />
    );

    // Coverage section heading
    expect(screen.getByText('Policy Coverage')).toBeInTheDocument();

    // Coverage amount (50000000 stroops = 5 XLM)
    expect(screen.getByText(/5\.00/)).toBeInTheDocument();

    // Status (lowercased)
    expect(screen.getByText('active')).toBeInTheDocument();

    // Expiry date rendered
    expect(screen.getByText(/2027/)).toBeInTheDocument();
  });

  it('does not render policy coverage section when policyCoverage is omitted', () => {
    render(<ReviewStep data={mockData} policyId={policyId} />);
    expect(screen.queryByText('Policy Coverage')).not.toBeInTheDocument();
  });

  it('handles empty evidence correctly', () => {
    render(<ReviewStep data={{ ...mockData, evidence: [] }} policyId={policyId} />);

    expect(screen.getByText('Evidence (0 files)')).toBeInTheDocument();
    expect(screen.getByText('No evidence uploaded.')).toBeInTheDocument();
  });

  it('triggers onEdit with correct step index when Edit is clicked', () => {
    render(<ReviewStep data={mockData} policyId={policyId} onEdit={mockOnEdit} />);

    // Edit Amount
    fireEvent.click(screen.getByRole('button', { name: /edit claim amount/i }));
    expect(mockOnEdit).toHaveBeenCalledWith(0);

    // Edit Narrative
    fireEvent.click(screen.getByRole('button', { name: /edit narrative/i }));
    expect(mockOnEdit).toHaveBeenCalledWith(1);

    // Edit Evidence
    fireEvent.click(screen.getByRole('button', { name: /edit evidence/i }));
    expect(mockOnEdit).toHaveBeenCalledWith(2);
  });

  it('does not render Edit buttons when onEdit is not provided', () => {
    render(<ReviewStep data={mockData} policyId={policyId} />);
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
  });

  it('renders all evidence file names and hashes', () => {
    const evidence = [
      {
        url: 'ipfs://QmABC123/photo.jpg',
        contentSha256Hex: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      },
    ];
    render(<ReviewStep data={{ ...mockData, evidence }} policyId={policyId} />);

    expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    expect(screen.getByText('abcdef12345678...34567890')).toBeInTheDocument();
  });
});
