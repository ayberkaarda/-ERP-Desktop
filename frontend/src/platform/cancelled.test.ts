import * as platformIndex from './index'
import { isPlatformCancelled, PlatformCancelledError } from './shared'
import { ApiError } from './types'

describe('runtime cancellation marker', () => {
  it('is exported from @/platform', () => {
    expect(platformIndex.PlatformCancelledError).toBeTypeOf('function')
    expect(platformIndex.PlatformCancelledError).toBe(PlatformCancelledError)
    expect(platformIndex.isPlatformCancelled).toBe(isPlatformCancelled)
  })

  it('is an Error named PlatformCancelled', () => {
    const error = new PlatformCancelledError()
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('PlatformCancelled')
    expect(new PlatformCancelledError('pending work').message).toBe('pending work')
  })

  it('recognises the marker, also by name across module copies', () => {
    expect(isPlatformCancelled(new PlatformCancelledError())).toBe(true)
    const foreign = new Error('x')
    foreign.name = 'PlatformCancelled'
    expect(isPlatformCancelled(foreign)).toBe(true)
  })

  it.each([
    [new Error('boom')],
    [new ApiError(500, 'SERVER_ERROR', 'x')],
    [{ name: 'PlatformCancelled' }],
    ['PlatformCancelled'],
    [null],
  ])('does not treat %j as a cancellation', (value) => {
    expect(isPlatformCancelled(value)).toBe(false)
  })
})
