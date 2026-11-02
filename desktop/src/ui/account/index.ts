// Server profiles, sign-in, password change hand-off, devices and recovery
// screens. This file is the package's only public surface.

import { createElement } from 'react'

import type { ExtensionPart } from '../../app/compose'
import { DesktopLoginPage } from './DesktopLoginPage'
import { DesktopSecurityExtras } from './DesktopSecurityExtras'
import { ExternalPasswordChangePage } from './ExternalPasswordChangePage'
import { SetupPage } from './ProfilesPage'

export { AccountGate, AppGate } from './AppGate'
export { parseProfileState, PROFILE_STATE_EVENT } from './profileState'
export { bridgeOf, type ShellBridge } from './bridge'
export { loadAppServices } from './defaults'
export { DesktopLoginPage } from './DesktopLoginPage'
export { DesktopSecurityExtras } from './DesktopSecurityExtras'
export { ExternalPasswordChangePage } from './ExternalPasswordChangePage'
export { PendingWorkDialog } from './PendingWorkDialog'
export { ProfilesPage, SetupPage } from './ProfilesPage'
export type { AccountServices, WebSession } from './services'

/** What ui/account adds to the web app's extension points. */
export const accountExtensions: ExtensionPart = {
  LoginPage: DesktopLoginPage,
  PasswordChangePage: ExternalPasswordChangePage,
  SecurityExtras: DesktopSecurityExtras,
  publicRoutes: [{ path: '/setup', element: createElement(SetupPage) }],
}
