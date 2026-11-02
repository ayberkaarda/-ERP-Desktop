import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

import { DESKTOP_ALIASES } from './tooling/aliases'
import { moduleSwap } from './tooling/moduleSwap'
import { DESKTOP_SWAPS } from './tooling/swaps'

// Tests run with the same module swap as the bundle, so a web component under
// test gets the desktop platform runtime and extensions, as in the window.
export default defineConfig({
  plugins: [moduleSwap(DESKTOP_SWAPS), react()],
  resolve: {
    alias: { ...DESKTOP_ALIASES },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tooling/**/*.test.ts'],
    css: false,
  },
})
