/**
 * @jest-environment jsdom
 */

import React from 'react'
import { render, screen } from '@testing-library/react'

import { BottomTabBar } from '../BottomTabBar'

const mockPathname = jest.fn(() => '/')

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}))

jest.mock('next/link', () => {
  return function MockLink({
    href,
    children,
    ...props
  }: React.PropsWithChildren<{ href: string } & Record<string, unknown>>) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  }
})

function setViewportMobile() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: query.includes('max-width') && query.includes('767px'),
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  })
}

describe('BottomTabBar', () => {
  beforeEach(() => {
    mockPathname.mockReturnValue('/')
    setViewportMobile()
  })

  it('is visible on mobile viewport and hidden on desktop via responsive classes', () => {
    const { container } = render(<BottomTabBar />)
    const nav = container.querySelector('nav')
    expect(nav).toHaveClass('md:hidden')
    expect(nav).toBeInTheDocument()
  })

  it('highlights the active tab based on the current route', () => {
    mockPathname.mockReturnValue('/claims')
    render(<BottomTabBar />)

    const claimsLink = screen.getByRole('link', { name: /claims/i })
    expect(claimsLink).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /home/i })).not.toHaveAttribute('aria-current')
  })

  it('tab links navigate to the correct routes', () => {
    render(<BottomTabBar />)

    expect(screen.getByRole('link', { name: /home/i })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /policies/i })).toHaveAttribute('href', '/policies')
    expect(screen.getByRole('link', { name: /claims/i })).toHaveAttribute('href', '/claims')
    expect(screen.getByRole('link', { name: /settings/i })).toHaveAttribute('href', '/settings')
  })
})
