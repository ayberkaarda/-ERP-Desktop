import { defineConfig } from 'vite'

// Desktop webview bundle. Port 1420 is `build.devUrl` in src-tauri/tauri.conf.json.
export default defineConfig({
  clearScreen: false,
  server: {
    host: 'localhost',
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
  },
})
