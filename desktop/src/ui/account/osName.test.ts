import { describe, expect, it } from 'vitest'

import { osName } from './osName'

describe('osName', () => {
  it('capitalises the target OS', () => {
    expect(osName('windows')).toBe('Windows')
    expect(osName('macos')).toBe('macOS')
    expect(osName('plan9')).toBe('Plan9')
  })
})
