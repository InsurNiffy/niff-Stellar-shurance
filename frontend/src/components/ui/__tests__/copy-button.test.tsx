/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { CopyButton } from '../copy-button'

describe('CopyButton', () => {
  let writeText: jest.Mock

  beforeEach(() => {
    writeText = jest.fn().mockResolvedValue(undefined)
    if (!navigator.clipboard) {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      })
    } else {
      jest.spyOn(navigator.clipboard, 'writeText').mockImplementation(writeText)
    }
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('renders with Copy aria-label initially', () => {
    render(<CopyButton text="abc" />)
    expect(screen.getByRole('button', { name: 'Copy to clipboard' })).toBeInTheDocument()
  })

  it('shows Copied! aria-label after click', async () => {
    const user = userEvent.setup()
    render(<CopyButton text="abc" />)
    await user.click(screen.getByRole('button'))
    expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument()
  })

  it('calls clipboard.writeText with the provided text', async () => {
    const user = userEvent.setup()
    render(<CopyButton text="my-text" />)
    await user.click(screen.getByRole('button'))
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('my-text')
    })
  })

  it('resets aria-label back to Copy to clipboard after resetMs', async () => {
    jest.useFakeTimers()
    render(<CopyButton text="abc" resetMs={500} />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument()
    })

    act(() => {
      jest.advanceTimersByTime(500)
    })
    expect(screen.getByRole('button', { name: 'Copy to clipboard' })).toBeInTheDocument()
  })
})
