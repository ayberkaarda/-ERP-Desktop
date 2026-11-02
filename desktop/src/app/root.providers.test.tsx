import { render, screen } from '@testing-library/react'
import { createMemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { DesktopRoot } from './root'

// As in the web main.tsx, the error boundary sits outside the providers: a
// provider that fails at start-up (i18n, query client, toaster) still ends in
// the full-screen error, not a blank window.
vi.mock('@/app/providers', () => ({
  Providers: () => {
    throw new Error('provider failed')
  },
}))

describe('DesktopRoot error boundary', () => {
  it('catches a failure of the providers', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<DesktopRoot router={createMemoryRouter([{ path: '/', element: <p>never</p> }])} />)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('never')).not.toBeInTheDocument()
  })
})
