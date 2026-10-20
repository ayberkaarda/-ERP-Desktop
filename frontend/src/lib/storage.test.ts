import { createSafeStorage } from './storage'

const throwing = {
  getItem: () => {
    throw new DOMException('denied', 'SecurityError')
  },
  setItem: () => {
    throw new DOMException('full', 'QuotaExceededError')
  },
  removeItem: () => {
    throw new DOMException('denied', 'SecurityError')
  },
} as unknown as Storage

describe('safe storage', () => {
  it('falls back to memory when storage throws', async () => {
    const storage = createSafeStorage(() => throwing)
    expect(await storage.getItem('k')).toBeNull()
    await storage.setItem('k', 'v')
    expect(await storage.getItem('k')).toBe('v')
    await storage.removeItem('k')
    expect(await storage.getItem('k')).toBeNull()
  })

  it('falls back to memory when access to storage itself throws', async () => {
    const storage = createSafeStorage(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    await storage.setItem('k', 'v')
    expect(await storage.getItem('k')).toBe('v')
  })

  it('uses real storage when available', async () => {
    const storage = createSafeStorage(() => window.localStorage)
    await storage.setItem('keystone.test', '1')
    expect(window.localStorage.getItem('keystone.test')).toBe('1')
    window.localStorage.removeItem('keystone.test')
  })
})
