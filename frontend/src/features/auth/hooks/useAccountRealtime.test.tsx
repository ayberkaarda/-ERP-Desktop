import { screen, waitFor } from '@testing-library/react'
import { platform } from '@/platform'
import { AccessRevoked } from '@/features/company/components/AccessRevoked'
import { useAuthStore } from '@/stores/auth'
import { useCompanyStore } from '@/stores/company'
import { COMPANY_A, COMPANY_B } from '@/test/handlers/fea'
import { renderRoutes, setupFea, signIn } from '@/test/handlers/feaRender'
import {
  MEMBERSHIP_REVOKED_EVENT,
  SESSION_REVOKED_EVENT,
  useAccountRealtime,
} from './useAccountRealtime'

function Harness() {
  useAccountRealtime()
  const active = useCompanyStore((s) => s.activeCompanyId)
  const revoked = useCompanyStore((s) => s.accessRevoked)
  return revoked ? <AccessRevoked /> : <p>active:{active}</p>
}

function setup() {
  const db = setupFea()
  signIn(db)
  const handlers = new Map<string, (payload: unknown) => void>()
  const channels: string[] = []
  vi.spyOn(platform.realtime, 'listenPrivate').mockImplementation((channel, event, h) => {
    channels.push(channel)
    handlers.set(event, h)
    return () => undefined
  })
  const info = vi.spyOn(platform.notify, 'info').mockImplementation(() => undefined)
  renderRoutes([{ path: '/', element: <Harness /> }])
  return { db, handlers, channels, info }
}

describe('useAccountRealtime', () => {
  it('listens on the user channel for both events', () => {
    const { db, handlers, channels } = setup()
    expect(channels).toEqual([`user.${db.user.id}`, `user.${db.user.id}`])
    expect([...handlers.keys()].sort()).toEqual([MEMBERSHIP_REVOKED_EVENT, SESSION_REVOKED_EVENT])
  })

  it('switches to a remaining company after the active one is revoked', async () => {
    const { db, handlers, info } = setup()
    expect(useCompanyStore.getState().activeCompanyId).toBe(COMPANY_A)
    db.companies = db.companies.filter((c) => c.id !== COMPANY_A)
    handlers.get(MEMBERSHIP_REVOKED_EVENT)?.({ company_id: COMPANY_A })

    await waitFor(() => expect(screen.getByText(`active:${COMPANY_B}`)).toBeInTheDocument())
    await waitFor(() => expect(useAuthStore.getState().permissionsState).toBe('fresh'))
    expect(useCompanyStore.getState().companies.map((c) => c.id)).toEqual([COMPANY_B])
    expect(info).toHaveBeenCalledWith(expect.stringContaining('Ege Dış Ticaret'))
    expect(useCompanyStore.getState().accessRevoked).toBe(false)
  })

  it('refreshes memberships but keeps the active company when another one is revoked', async () => {
    const { db, handlers } = setup()
    db.companies = db.companies.filter((c) => c.id !== COMPANY_B)
    handlers.get(MEMBERSHIP_REVOKED_EVENT)?.({ company_id: COMPANY_B })

    await waitFor(() =>
      expect(useCompanyStore.getState().companies.map((c) => c.id)).toEqual([COMPANY_A]),
    )
    expect(screen.getByText(`active:${COMPANY_A}`)).toBeInTheDocument()
    expect(db.calls.some((c) => c.path.endsWith('/auth/me'))).toBe(true)
  })

  it('shows the access-revoked state when no company remains', async () => {
    const { db, handlers } = setup()
    db.companies = []
    handlers.get(MEMBERSHIP_REVOKED_EVENT)?.({ company_id: COMPANY_A })
    expect(await screen.findByText('Şirket erişimi kaldırıldı')).toBeInTheDocument()
    await waitFor(() => expect(useAuthStore.getState().permissionsState).toBe('fresh'))
    expect(useCompanyStore.getState().accessRevoked).toBe(true)
    expect(useAuthStore.getState().status).toBe('authenticated')
  })

  it('still ends the session on session.revoked', () => {
    const { handlers, info } = setup()
    handlers.get(SESSION_REVOKED_EVENT)?.({ reason: 'deactivated' })
    expect(useAuthStore.getState().status).toBe('anonymous')
    expect(useCompanyStore.getState().companies).toEqual([])
    expect(info).toHaveBeenCalled()
  })
})
