import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import i18n from '@/lib/i18n'
import { server } from './msw/server'

// jsdom lacks matchMedia; theme code queries it on every render.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
})

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' })
})
beforeEach(async () => {
  await i18n.changeLanguage('tr')
})
afterEach(() => {
  cleanup()
  server.resetHandlers()
})
afterAll(() => {
  server.close()
})
