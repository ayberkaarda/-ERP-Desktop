import { act, render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { isValidElement } from 'react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'

import { addDesktopResources } from '../../i18n'
import { ConflictInboxPage, OutboxPage, SyncDepsProvider, SyncHeader, syncExtensions, useDesktopOnlineOnly } from '.'
import { fakeConnectivity, fakeNotify } from './testing'
import { appExtensions } from '@/app/extensions'
import type { HttpClient } from '@/platform/types'

describe('sync extension part', () => {
  it('fills the header slot, the two sync pages and the online-only hook', () => {
    expect(syncExtensions.HeaderExtras).toBe(SyncHeader)
    expect(syncExtensions.useOnlineOnly).toBe(useDesktopOnlineOnly)
    const routes = (syncExtensions.routes ?? []).map((r) => [
      r.path,
      isValidElement(r.element) ? r.element.type : undefined,
    ])
    expect(routes).toEqual([
      ['sync/outbox', OutboxPage],
      ['sync/conflicts', ConflictInboxPage],
    ])
  })

  it('is part of the desktop app extensions', () => {
    expect(appExtensions.HeaderExtras).toBe(SyncHeader)
    expect(appExtensions.useOnlineOnly).toBe(useDesktopOnlineOnly)
    expect(appExtensions.routes.map((r) => r.path)).toEqual(expect.arrayContaining(['sync/outbox', 'sync/conflicts']))
  })

  it('the online-only hook follows the platform connection', async () => {
    const i18n = i18next.createInstance()
    await i18n.init({ lng: 'tr', fallbackLng: 'tr', resources: {} })
    addDesktopResources(i18n)
    const net = fakeConnectivity(true)
    function Probe() {
      const state = useDesktopOnlineOnly('closePeriod')
      return <output>{state.disabled ? `off: ${state.reason ?? ''}` : 'on'}</output>
    }
    render(
      <I18nextProvider i18n={i18n}>
        <SyncDepsProvider
          deps={{
            bridge: null,
            connectivity: net.value,
            offlineMeta: null,
            http: {} as HttpClient,
            notify: fakeNotify(),
          }}
        >
          <Probe />
        </SyncDepsProvider>
      </I18nextProvider>,
    )
    expect(screen.getByRole('status')).toHaveTextContent('on')
    act(() => {
      net.set(false)
    })
    expect(screen.getByRole('status')).toHaveTextContent('off: Bu işlem yalnız çevrimiçiyken yapılabilir.')
  })
})
