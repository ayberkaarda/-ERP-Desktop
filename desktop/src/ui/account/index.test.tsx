import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { appExtensions as webSlotExtensions } from '@/app/extensions'
import { Providers } from '@/app/providers'
import { platform as webPlatform } from '@/platform'
import { AppGate as RootGate } from '../../app/root'
import { PARTS } from '../../app/extensions'
import { createDesktopPlatform, desktopBridgeOf } from '../../platform'
import { createFakeBridge } from '../../test/fakeBridge'
import {
  accountExtensions,
  AppGate,
  bridgeOf,
  DesktopLoginPage,
  DesktopSecurityExtras,
  ExternalPasswordChangePage,
  ProfilesPage,
  PendingWorkDialog,
} from '.'

function desktopPlatform() {
  const fake = createFakeBridge({
    commands: { profile_list: () => ({ profiles: [] }), sync_status: () => null, realtime_status: () => null },
  })
  const platform = createDesktopPlatform({
    deps: { getCompanyId: () => null, getLocale: () => 'tr', getSessionGeneration: () => 0, onAuthFailure: () => undefined },
    invoke: fake.invoke,
    listen: fake.listen,
  })
  return { fake, platform }
}

describe('ui/account surface', () => {
  it('fills the sign-in, password, security and setup extension points', () => {
    expect(accountExtensions.LoginPage).toBe(DesktopLoginPage)
    expect(accountExtensions.PasswordChangePage).toBe(ExternalPasswordChangePage)
    expect(accountExtensions.SecurityExtras).toBe(DesktopSecurityExtras)
    expect(accountExtensions.publicRoutes?.map((r) => r.path)).toEqual(['/setup'])
    expect(accountExtensions.HeaderExtras).toBeUndefined()
    expect(accountExtensions.useOnlineOnly).toBeUndefined()
    expect(ProfilesPage).toBeTypeOf('function')
    expect(PendingWorkDialog).toBeTypeOf('function')
  })

  it('is plugged into the desktop extensions and the root gate', () => {
    expect(PARTS.find(([name]) => name === 'account')?.[1]).toBe(accountExtensions)
    expect(webSlotExtensions.LoginPage).toBe(DesktopLoginPage)
    expect(webSlotExtensions.publicRoutes.some((r) => r.path === '/setup')).toBe(true)
    expect(RootGate).toBe(AppGate)
  })

  it('takes the bridge the desktop platform carries, none on the web platform', () => {
    const { platform } = desktopPlatform()
    expect(bridgeOf(platform)).toBe(platform.desktop.bridge)
    expect(bridgeOf({ ...platform, kind: 'web' } as never)).toBeNull()
  })

  it('the app platform carries a bridge', () => {
    expect(bridgeOf(webPlatform)).not.toBeNull()
    expect(bridgeOf(webPlatform)).toBe(desktopBridgeOf(webPlatform))
  })

  it('outside the shell window the default gate leaves the web app as it is', async () => {
    render(
      <Providers>
        <AppGate>
          <p>web app</p>
        </AppGate>
      </Providers>,
    )
    expect(await screen.findByText('web app')).toBeInTheDocument()
  })
})
