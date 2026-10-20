import { act, render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import i18n from '@/lib/i18n'
import { ApprovalTimeline } from './ApprovalTimeline'
import { AuditTrail } from './AuditTrail'
import { ConfirmDialog } from './ConfirmDialog'
import { EmptyState } from './EmptyState'
import { useDebouncedValue } from './hooks/useDebouncedValue'
import { PageHeader } from './PageHeader'
import { StatusBadge } from './StatusBadge'

describe('StatusBadge', () => {
  it('labels known statuses per language and accepts module definitions', async () => {
    const { rerender } = render(<StatusBadge status="pending_approval" />)
    expect(screen.getByText('Onay bekliyor')).toBeInTheDocument()
    await act(() => i18n.changeLanguage('de'))
    expect(screen.getByText('Wartet auf Freigabe')).toBeInTheDocument()
    rerender(
      <StatusBadge
        status="shipped"
        definitions={{ shipped: { tone: 'info', label: 'Versandt' } }}
      />,
    )
    expect(screen.getByText('Versandt')).toHaveAttribute('data-status', 'shipped')
    rerender(<StatusBadge status="mystery" />)
    expect(screen.getByText('mystery')).toBeInTheDocument()
  })
})

describe('own-property lookups', () => {
  it('does not resolve inherited keys as statuses or labels', () => {
    render(
      <>
        <StatusBadge status="constructor" />
        <AuditTrail
          fieldLabels={{}}
          entries={[
            {
              id: 'x',
              event: 'updated',
              causer: null,
              created_at: '2026-10-20T11:12:00Z',
              properties: { attributes: { toString: 'b' }, old: {} },
            },
          ]}
        />
      </>,
    )
    expect(screen.getByText('constructor')).toHaveAttribute('data-status', 'constructor')
    expect(screen.getByRole('rowheader', { name: 'toString' })).toBeInTheDocument()
    expect(screen.getByText('b')).toBeInTheDocument()
  })
})

describe('ApprovalTimeline', () => {
  it('orders steps and marks the pending one', () => {
    render(
      <ApprovalTimeline
        steps={[
          { id: 'b', order: 2, state: 'pending', approvers: ['Finans'], threshold: '50000' },
          {
            id: 'a',
            order: 1,
            name: 'Yönetici',
            state: 'approved',
            approvers: [],
            decision: {
              actor: 'Ayşe',
              decision: 'approve',
              comment: 'Uygun',
              decidedAt: '2026-10-20T07:45:00Z',
            },
          },
        ]}
      />,
    )
    const items = within(screen.getByRole('list', { name: 'Onay süreci' })).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Yönetici')
    expect(items[0]).toHaveTextContent('Ayşe onayladı')
    expect(items[0]).toHaveTextContent('20.10.2026 10:45')
    expect(items[1]).toHaveAttribute('aria-current', 'step')
    expect(items[1]).toHaveTextContent('2. adım')
    expect(items[1]).toHaveTextContent('Tutar eşiği: ₺50.000,00')
  })

  it('shows an empty state without steps', () => {
    render(<ApprovalTimeline steps={[]} />)
    expect(screen.getByText('Bu belge için onay süreci başlatılmadı.')).toBeInTheDocument()
  })
})

describe('AuditTrail', () => {
  it('renders changes with before and after values', async () => {
    const user = userEvent.setup()
    const onMore = vi.fn()
    render(
      <AuditTrail
        hasMore
        onLoadMore={onMore}
        fieldLabels={{ status: 'Durum' }}
        entries={[
          {
            id: '1',
            event: 'updated',
            causer: { id: 'u', name: 'Mehmet' },
            created_at: '2026-10-20T11:12:00Z',
            properties: {
              attributes: { status: 'approved', note: null },
              old: { status: 'draft', note: 'x' },
            },
          },
          { id: '2', event: 'created', causer: null, created_at: '2026-10-19T08:00:00Z' },
        ]}
      />,
    )
    expect(screen.getByText('Mehmet')).toBeInTheDocument()
    const row = screen.getByRole('rowheader', { name: 'Durum' }).closest('tr')
    if (!row) throw new Error('row missing')
    expect(within(row).getByText('draft')).toBeInTheDocument()
    expect(within(row).getByText('approved')).toBeInTheDocument()
    expect(screen.getByText('(boş)')).toBeInTheDocument()
    expect(screen.getByText('Sistem')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Daha fazla göster' }))
    expect(onMore).toHaveBeenCalled()
  })
})

describe('ConfirmDialog', () => {
  it('waits for async confirmation and stays open on failure', async () => {
    const user = userEvent.setup()
    let fail = true
    const onConfirm = vi.fn(() => (fail ? Promise.reject(new Error('x')) : Promise.resolve()))
    render(
      <ConfirmDialog
        trigger={<button type="button">Sil</button>}
        description="Kalıcı"
        onConfirm={onConfirm}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Sil' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Emin misiniz?' })
    await user.click(within(dialog).getByRole('button', { name: 'Onayla' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    fail = false
    await user.click(within(dialog).getByRole('button', { name: 'Onayla' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

describe('PageHeader and EmptyState', () => {
  it('renders breadcrumbs, title and actions', () => {
    const router = createMemoryRouter([
      {
        path: '/',
        element: (
          <PageHeader
            title="Faturalar"
            breadcrumbs={[{ label: 'Satış', to: '/sales' }, { label: 'Faturalar' }]}
            actions={<button type="button">Yeni</button>}
          />
        ),
      },
    ])
    render(<RouterProvider router={router} />)
    const nav = screen.getByRole('navigation', { name: 'Sayfa yolu' })
    expect(within(nav).getByRole('link', { name: 'Satış' })).toHaveAttribute('href', '/sales')
    expect(within(nav).getByText('Faturalar')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { level: 1, name: 'Faturalar' })).toBeInTheDocument()
  })

  it('uses the default empty title', () => {
    render(<EmptyState action={<button type="button">Ekle</button>} />)
    expect(screen.getByText('Burada henüz bir şey yok')).toBeInTheDocument()
  })
})

describe('useDebouncedValue', () => {
  it('settles after the delay', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 200), {
      initialProps: { v: 'a' },
    })
    rerender({ v: 'ab' })
    rerender({ v: 'abc' })
    expect(result.current).toBe('a')
    act(() => {
      vi.advanceTimersByTime(199)
    })
    expect(result.current).toBe('a')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe('abc')
    vi.useRealTimers()
  })
})
