import { describe, expect, expectTypeOf, it } from 'vitest'

import { composeExtensions, SLOTS, type Slot } from './compose'
import { appExtensions, PARTS } from './extensions'

const Header = () => null
const Login = () => null
const useAvailable = () => ({ disabled: false })

describe('composeExtensions', () => {
  it('gives the empty web extensions without parts', () => {
    expect(composeExtensions([])).toEqual({ routes: [], publicRoutes: [] })
  })

  it('joins the route lists in part order', () => {
    const result = composeExtensions([
      ['sync', { routes: [{ path: 'sync/outbox' }, { path: 'sync/conflicts' }] }],
      ['account', { routes: [{ path: 'profiles' }], publicRoutes: [{ path: '/setup' }] }],
    ])
    expect(result.routes.map((route) => route.path)).toEqual(['sync/outbox', 'sync/conflicts', 'profiles'])
    expect(result.publicRoutes.map((route) => route.path)).toEqual(['/setup'])
  })

  it('takes each slot from the part that fills it', () => {
    const result = composeExtensions([
      ['sync', { HeaderExtras: Header, useOnlineOnly: useAvailable }],
      ['account', { LoginPage: Login }],
    ])
    expect(result.HeaderExtras).toBe(Header)
    expect(result.useOnlineOnly).toBe(useAvailable)
    expect(result.LoginPage).toBe(Login)
    expect(result.PasswordChangePage).toBeUndefined()
    expect(result.SecurityExtras).toBeUndefined()
  })

  it('refuses a slot filled by two parts', () => {
    expect(() =>
      composeExtensions([
        ['sync', { HeaderExtras: Header }],
        ['account', { HeaderExtras: Login }],
      ]),
    ).toThrow('appExtensions.HeaderExtras is set by both sync and account')
  })

  it('knows every single slot of the web AppExtensions', () => {
    expectTypeOf<Exclude<Slot, (typeof SLOTS)[number]>>().toBeNever()
    expect(new Set(SLOTS).size).toBe(SLOTS.length)
  })
})

describe('appExtensions (desktop)', () => {
  it('is the composition of the package parts', () => {
    expect(appExtensions).toEqual(composeExtensions(PARTS))
  })

  it('names every part once', () => {
    const names = PARTS.map(([name]) => name)
    expect(new Set(names).size).toBe(names.length)
  })
})
