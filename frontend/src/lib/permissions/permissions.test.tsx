import { act, render, screen } from '@testing-library/react'
import { useAuthStore, type SessionUser } from '@/stores/auth'
import { useCompanyStore } from '@/stores/company'
import { Can } from './Can'
import { anyOf, checkPermission, hasPermission } from './permissions'

const user: SessionUser = {
  id: 'u',
  name: 'U',
  email: 'u@test',
  locale: null,
  isSuperAdmin: false,
  mustChangePassword: false,
  twoFactorEnabled: false,
}

describe('permissions', () => {
  beforeEach(() => {
    useCompanyStore.setState({
      companies: [
        { id: 'a', name: 'A', roleNames: [] },
        { id: 'b', name: 'B', roleNames: [] },
      ],
      activeCompanyId: 'a',
    })
    useAuthStore.setState({
      status: 'authenticated',
      user,
      permissions: { a: ['invoices.view'], b: ['invoices.view', 'invoices.create'] },
    })
  })

  it('checks all/any requirements and denies anonymous users', () => {
    const ctx = { user, granted: ['a.view', 'a.create'] }
    expect(hasPermission(ctx, 'a.view')).toBe(true)
    expect(hasPermission(ctx, ['a.view', 'a.delete'])).toBe(false)
    expect(hasPermission(ctx, ['a.view', 'a.delete'], 'any')).toBe(true)
    expect(hasPermission(ctx, anyOf('a.delete', 'a.create'))).toBe(true)
    expect(hasPermission(ctx, anyOf('a.delete', 'a.manage'))).toBe(false)
    expect(hasPermission({ ...ctx, stale: true }, anyOf('a.view'))).toBe(false)
    expect(hasPermission(ctx, undefined)).toBe(true)
    expect(hasPermission({ user: null, granted: ['a.view'] }, 'a.view')).toBe(false)
    expect(hasPermission({ user: { ...user, isSuperAdmin: true }, granted: [] }, 'x.y')).toBe(true)
  })

  it('follows the active company', () => {
    expect(checkPermission('invoices.create')).toBe(false)
    useCompanyStore.getState().setActiveCompany('b')
    expect(checkPermission('invoices.create')).toBe(true)
  })

  it('<Can> renders children or the fallback and reacts to company switches', () => {
    render(
      <Can permission="invoices.create" fallback={<span>no</span>}>
        <button type="button">Yeni fatura</button>
      </Can>,
    )
    expect(screen.getByText('no')).toBeInTheDocument()
    act(() => useCompanyStore.getState().setActiveCompany('b'))
    expect(screen.getByRole('button', { name: 'Yeni fatura' })).toBeInTheDocument()
  })
})
