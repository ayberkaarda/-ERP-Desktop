import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { moduleSwap } from './tooling/moduleSwap'
import { DESKTOP_SWAPS } from './tooling/swaps'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

interface TauriConf {
  app: { security: { devCsp: string } }
}

// `tauri dev` loads the page from this server, so the window gets no policy
// from Tauri: the server sends devCsp itself (src-tauri/tauri.conf.json).
const tauriConf = JSON.parse(readFileSync(here('./src-tauri/tauri.conf.json'), 'utf8')) as TauriConf
export const DEV_CSP = tauriConf.app.security.devCsp

// Vite's own inline tags in dev (React refresh preamble, injected styles)
// carry this nonce; devCsp allows it. The build output has no inline tags
// but the theme script, whose hash Tauri adds.
export const DEV_NONCE = /'nonce-([^']+)'/.exec(DEV_CSP)?.[1] ?? ''

// Desktop webview bundle: the web app of ../frontend/src with two modules
// swapped (tooling/swaps.ts). Port 1420 is `build.devUrl` in tauri.conf.json.
export default defineConfig(({ command }) => ({
  root: here('.'),
  clearScreen: false,
  plugins: [moduleSwap(DESKTOP_SWAPS), react(), tailwindcss()],
  resolve: {
    alias: {
      '@desktop': here('./src'),
      '@': here('../frontend/src'),
    },
  },
  html: command === 'serve' ? { cspNonce: DEV_NONCE } : {},
  server: {
    host: 'localhost',
    port: 1420,
    strictPort: true,
    headers: { 'Content-Security-Policy': DEV_CSP },
    // The web sources and the hoisted node_modules live above desktop/.
    fs: { allow: [here('..')] },
    watch: { ignored: ['**/src-tauri/**', '**/target/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
  },
}))
