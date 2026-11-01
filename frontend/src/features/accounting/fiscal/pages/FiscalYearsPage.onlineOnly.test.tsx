import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AppExtensions } from '@/app/extensions'
import { renderAccounting, setupAccounting } from '../../shared/testing'
import './FiscalYearsPage'

// A runtime with an offline mode disables server-only actions through the online-only extension.
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

describe('FiscalYearsPage online-only actions', () => {
  it('disables closing a year when the runtime reports closePeriod unavailable', async () => {
    const asked = vi.fn((action: string) =>
      action === 'closePeriod'
        ? { disabled: true, reason: 'Bu işlem için bağlantı gerekir.' }
        : { disabled: false },
    )
    ext.value = { routes: [], publicRoutes: [], useOnlineOnly: asked }
    const db = setupAccounting()
    const user = userEvent.setup()
    renderAccounting('/accounting/fiscal-years')
    await screen.findByText('2026 hesap dönemi')
    const close = screen.getByRole('button', { name: 'Yılı kapat' })
    expect(asked).toHaveBeenCalledWith('closePeriod')
    expect(close).toHaveAttribute('aria-disabled', 'true')
    await user.click(close)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(db.calls.filter((c) => c.method === 'POST')).toHaveLength(0)
    // Creating a year is not a manifest online-only action and stays available.
    expect(screen.getByRole('button', { name: 'Yeni mali yıl' })).not.toHaveAttribute(
      'aria-disabled',
    )
  })

  it('keeps the close action working while the runtime allows it', async () => {
    setupAccounting()
    const user = userEvent.setup()
    renderAccounting('/accounting/fiscal-years')
    await screen.findByText('2026 hesap dönemi')
    const close = screen.getByRole('button', { name: 'Yılı kapat' })
    expect(close).not.toHaveAttribute('aria-disabled')
    await user.click(close)
    expect(
      await screen.findByRole('dialog', { name: '2026 mali yılı kapatılsın mı?' }),
    ).toBeInTheDocument()
  })
})
