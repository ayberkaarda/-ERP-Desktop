import { fileURLToPath } from 'node:url'

/**
 * Import aliases shared by the desktop bundle (vite.desktop.config.ts) and the
 * tests (vitest.config.ts): `@` is the web app, `@desktop` the desktop sources.
 */
export const DESKTOP_ALIASES: Readonly<Record<'@desktop' | '@', string>> = {
  '@desktop': fileURLToPath(new URL('../src', import.meta.url)),
  '@': fileURLToPath(new URL('../../frontend/src', import.meta.url)),
}
