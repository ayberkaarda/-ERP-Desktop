import { render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Providers } from '@/app/providers'
import type { AppExtensions } from '@/app/extensions'
import { createQueryClient } from '@/lib/queryClient'
import { OnlineOnlyButton, useOnlineOnly } from '.'

const ext = vi.hoisted((): { value: AppExtensions } => ({
  value: { routes: [], publicRoutes: [] },
}))
vi.mock('@/app/extensions', () => ({
  get appExtensions() {
    return ext.value
  },
}))

afterEach(() => {
  ext.value = { routes: [], publicRoutes: [] }
})

function renderButton(onClick = vi.fn()) {
  render(
    <Providers queryClient={createQueryClient()}>
      <OnlineOnlyButton action="sales-invoices.finalize" onClick={onClick}>
        Kesinleştir
      </OnlineOnlyButton>
    </Providers>,
  )
  return onClick
}

describe('online-only primitive', () => {
  it('is always available on web', () => {
    const { result } = renderHook(() => useOnlineOnly('sales-invoices.finalize'))
    expect(result.current).toEqual({ disabled: false })
  })

  it('asks the runtime extension with the action name', () => {
    const hook = vi.fn(() => ({ disabled: true, reason: 'Çevrimdışı' }))
    ext.value = { routes: [], publicRoutes: [], useOnlineOnly: hook }
    const { result } = renderHook(() => useOnlineOnly('stock-documents.post'))
    expect(hook).toHaveBeenCalledWith('stock-documents.post')
    expect(result.current).toEqual({ disabled: true, reason: 'Çevrimdışı' })
  })

  it('renders a plain working button when available', async () => {
    const onClick = renderButton()
    const button = screen.getByRole('button', { name: 'Kesinleştir' })
    expect(button).toBeEnabled()
    await userEvent.setup().click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('disables the button and explains why when the runtime says so', async () => {
    ext.value = {
      routes: [],
      publicRoutes: [],
      useOnlineOnly: () => ({ disabled: true, reason: 'Bu işlem için bağlantı gerekir.' }),
    }
    const onClick = renderButton()
    const button = screen.getByRole('button', { name: 'Kesinleştir' })
    expect(button).toBeDisabled()
    const user = userEvent.setup()
    // Keyboard users reach the reason through the focusable wrapper.
    await user.tab()
    expect(document.activeElement).toBe(button.parentElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Bu işlem için bağlantı gerekir.')
    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('respects the caller disabling an available button', () => {
    render(
      <Providers queryClient={createQueryClient()}>
        <OnlineOnlyButton action="x" disabled>
          Kaydet
        </OnlineOnlyButton>
      </Providers>,
    )
    expect(screen.getByRole('button', { name: 'Kaydet' })).toBeDisabled()
  })
})
