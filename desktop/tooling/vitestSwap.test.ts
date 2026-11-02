import { describe, expect, it } from 'vitest'

import * as desktopExtensions from '@desktop/app/extensions'
import * as desktopRuntime from '@desktop/platform/runtime'
import * as webExtensions from '@/app/extensions'
import * as webRuntime from '@/platform/runtime'

// vitest.config.ts applies the bundle's module swap: a test that reaches the
// web runtime or extensions (directly or through @/platform, @/app/router)
// gets the desktop modules, as the window does.
describe('module swap under vitest', () => {
  it('resolves the web platform runtime to the desktop one', () => {
    expect(webRuntime.createPlatform).toBe(desktopRuntime.createPlatform)
  })

  it('resolves the web app extensions to the desktop composition', () => {
    expect(webExtensions.appExtensions).toBe(desktopExtensions.appExtensions)
  })
})
