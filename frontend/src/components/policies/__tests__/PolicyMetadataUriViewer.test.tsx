/**
 * @jest-environment jsdom
 *
 * Tests for PolicyMetadataUriViewer — verifies that the terms_hash is displayed
 * with a link to the versioned document (acceptance criteria for issue #843).
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { PolicyMetadataUriViewer } from '../PolicyMetadataUriViewer'

// ---------------------------------------------------------------------------
// Mock config so IPFS gateway is predictable
// ---------------------------------------------------------------------------
jest.mock('@/config/env', () => ({
  getConfig: () => ({
    apiUrl: 'http://localhost:3001',
    network: 'testnet',
    ipfsGateway: 'https://ipfs.io/ipfs',
  }),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const IPFS_URI = 'ipfs://QmSampleHash123456789'
const HTTP_URI = 'https://example.com/terms.pdf'
const SAMPLE_HASH = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PolicyMetadataUriViewer', () => {
  describe('when metadataUri is empty', () => {
    it('renders nothing', () => {
      const { container } = render(
        <PolicyMetadataUriViewer metadataUri="" />,
      )
      expect(container).toBeEmptyDOMElement()
    })
  })

  describe('document link', () => {
    it('renders an anchor pointing to the resolved IPFS gateway URL', () => {
      render(
        <PolicyMetadataUriViewer metadataUri={IPFS_URI} />,
      )
      const links = screen.getAllByRole('link')
      const docLink = links.find(
        (l) => l.getAttribute('href') === 'https://ipfs.io/ipfs/QmSampleHash123456789',
      )
      expect(docLink).toBeDefined()
      expect(docLink).toHaveAttribute('target', '_blank')
      expect(docLink).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('renders an anchor using the raw URI when not IPFS', () => {
      render(
        <PolicyMetadataUriViewer metadataUri={HTTP_URI} />,
      )
      const links = screen.getAllByRole('link')
      const docLink = links.find((l) => l.getAttribute('href') === HTTP_URI)
      expect(docLink).toBeDefined()
    })
  })

  describe('terms hash display', () => {
    it('does not render the hash section when termsHash is absent', () => {
      render(
        <PolicyMetadataUriViewer metadataUri={IPFS_URI} />,
      )
      expect(screen.queryByLabelText('Terms hash')).not.toBeInTheDocument()
      expect(screen.queryByText(/Terms Hash/i)).not.toBeInTheDocument()
    })

    it('does not render the hash section when termsHash is null', () => {
      render(
        <PolicyMetadataUriViewer metadataUri={IPFS_URI} termsHash={null} />,
      )
      expect(screen.queryByText(/Terms Hash/i)).not.toBeInTheDocument()
    })

    it('renders the hash value when termsHash is provided', () => {
      render(
        <PolicyMetadataUriViewer metadataUri={IPFS_URI} termsHash={SAMPLE_HASH} />,
      )
      expect(screen.getByLabelText('Terms hash')).toHaveTextContent(SAMPLE_HASH)
    })

    it('shows a "view document" link that points to the resolved document URL', () => {
      render(
        <PolicyMetadataUriViewer metadataUri={IPFS_URI} termsHash={SAMPLE_HASH} />,
      )
      const viewLink = screen.getByRole('link', { name: /view document/i })
      expect(viewLink).toHaveAttribute(
        'href',
        'https://ipfs.io/ipfs/QmSampleHash123456789',
      )
      expect(viewLink).toHaveAttribute('target', '_blank')
      expect(viewLink).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('includes a descriptive title on the view-document link for verification', () => {
      render(
        <PolicyMetadataUriViewer metadataUri={IPFS_URI} termsHash={SAMPLE_HASH} />,
      )
      const viewLink = screen.getByRole('link', { name: /view document/i })
      expect(viewLink).toHaveAttribute('title', expect.stringContaining(IPFS_URI))
    })

    it('shows the SHA-256 label alongside the hash', () => {
      render(
        <PolicyMetadataUriViewer metadataUri={IPFS_URI} termsHash={SAMPLE_HASH} />,
      )
      expect(screen.getByText(/Terms Hash \(SHA-256\)/i)).toBeInTheDocument()
    })
  })

  describe('non-IPFS warning', () => {
    it('shows a warning alert when metadataUri is not an IPFS URI', () => {
      render(
        <PolicyMetadataUriViewer metadataUri={HTTP_URI} termsHash={SAMPLE_HASH} />,
      )
      const alert = screen.getByRole('alert')
      expect(alert).toBeInTheDocument()
      expect(alert).toHaveTextContent(/not hosted on IPFS/i)
    })

    it('does NOT show the warning alert for IPFS URIs', () => {
      render(
        <PolicyMetadataUriViewer metadataUri={IPFS_URI} termsHash={SAMPLE_HASH} />,
      )
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('hash with HTTP metadataUri', () => {
    it('links the view-document anchor to the raw HTTP URI when not IPFS', () => {
      render(
        <PolicyMetadataUriViewer metadataUri={HTTP_URI} termsHash={SAMPLE_HASH} />,
      )
      const viewLink = screen.getByRole('link', { name: /view document/i })
      expect(viewLink).toHaveAttribute('href', HTTP_URI)
    })
  })
})
