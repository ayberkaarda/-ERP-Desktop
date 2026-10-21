import { screen } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { useAuthStore } from '@/stores/auth'
import { useCompanyStore } from '@/stores/company'
import { server } from '@/test/msw/server'
import { renderRoute } from '@/test/render'
import { createReferenceDb, referenceHandlers, REF_COMPANY, type ReferenceDb } from './reference'

export interface ReferenceSetup {
  db?: Partial<ReferenceDb>
  /** Granted permission names; undefined makes the user a super admin. */
  permissions?: string[]
}

/** Fresh stores and a fresh fake Reference API for one test. */
export function setupReference({ db: overrides = {}, permissions }: ReferenceSetup = {}) {
  const db = createReferenceDb(overrides)
  useCompanyStore.setState({
    companies: [{ id: REF_COMPANY, name: 'Anadolu Makina A.Ş.', roleNames: ['Admin'] }],
    activeCompanyId: REF_COMPANY,
  })
  useAuthStore.getState().setSession(
    {
      id: 'u1',
      name: 'Deniz Kaya',
      email: 'deniz@keystone.test',
      locale: 'tr',
      isSuperAdmin: permissions === undefined,
      mustChangePassword: false,
      twoFactorEnabled: false,
    },
    { [REF_COMPANY]: permissions ?? [] },
  )
  server.use(...referenceHandlers(db))
  return db
}

export function renderReference(element: ReactElement, path = '/') {
  return renderRoute(element, path)
}

/** Opens a combobox (it opens on typing or ArrowDown, not on click) and picks an option. */
export async function pickOption(user: UserEvent, input: HTMLElement, option: RegExp | string) {
  await user.click(input)
  await user.keyboard('{ArrowDown}')
  await user.click(await screen.findByRole('option', { name: option }))
}
