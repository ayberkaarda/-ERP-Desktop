import { describe, expect, it } from 'vitest'

import { cn } from '@/lib/utils'
import { DESKTOP_NS } from '@desktop/i18n'

// "@/" points at ../frontend/src and "@desktop/" at ./src, in both
// tsconfig paths (typecheck) and vitest aliases (this run).
describe('path aliases', () => {
  it('resolves @/ to the web sources', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })

  it('resolves @desktop/ to the desktop sources', () => {
    expect(DESKTOP_NS).toBe('desktop')
  })
})
