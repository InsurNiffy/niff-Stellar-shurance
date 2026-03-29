/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import React from 'react'

const routeErrorMock = jest.fn(({ segment }: { segment: string }) => (
  <div data-testid="route-error" data-segment={segment} />
))

jest.mock('@/components/route-error', () => ({
  RouteError: (props: { segment: string }) => routeErrorMock(props),
}))

import ClaimsError from '@/app/claims/error'
import PoliciesError from '@/app/policies/error'
import AdminError from '@/app/admin/error'

describe('Route segment error.tsx wiring', () => {
  const err = new Error('boom') as Error & { digest?: string }
  const reset = jest.fn()

  beforeEach(() => {
    routeErrorMock.mockClear()
  })

  it.each([
    [ClaimsError, 'claims'],
    [PoliciesError, 'policies'],
    [AdminError, 'admin'],
  ] as const)('passes segment to RouteError', (ErrorPage, segment) => {
    render(<ErrorPage error={err} reset={reset} />)
    expect(screen.getByTestId('route-error')).toHaveAttribute('data-segment', segment)
  })
})
