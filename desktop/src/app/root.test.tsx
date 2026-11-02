import { useQueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { createMemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppGate, DesktopRoot } from './root'

function routerWith(text: string) {
  return createMemoryRouter([{ path: '/', element: <p>{text}</p> }])
}

// Uses what Providers give: it throws when rendered outside them.
function ProbeGate({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  const { i18n } = useTranslation()
  return (
    <section data-testid="gate" data-ready={String(Boolean(client) && i18n.isInitialized)}>
      {children}
    </section>
  )
}

describe('DesktopRoot', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens the web routes through the default gate', async () => {
    expect(AppGate).toBeTypeOf('function')
    render(<DesktopRoot router={routerWith('web app')} />)
    expect(await screen.findByText('web app')).toBeInTheDocument()
  })

  it('puts the gate inside the providers and the router inside the gate', async () => {
    render(<DesktopRoot router={routerWith('inside')} gate={ProbeGate} />)
    const gate = await screen.findByTestId('gate')
    expect(gate).toHaveAttribute('data-ready', 'true')
    expect(gate).toContainElement(await screen.findByText('inside'))
  })

  it('shows the full-screen error when the gate fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const Broken = () => {
      throw new Error('gate failed')
    }
    render(<DesktopRoot router={routerWith('never')} gate={Broken} />)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('never')).not.toBeInTheDocument()
  })
})
