// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { build, normalizePath, type Rollup } from 'vite'
import { beforeAll, describe, expect, it } from 'vitest'

// The desktop webview bundle, built in memory with vite.desktop.config.ts.
// The web transport (axios, Echo, pusher, the CSRF cookie round trip) must not
// reach it: the webview talks to the network only through Tauri commands.

const configFile = fileURLToPath(new URL('../vite.desktop.config.ts', import.meta.url))

interface Bundle {
  modules: string[]
  code: string
  html: string
}

async function buildDesktop(): Promise<Bundle> {
  const result = await build({
    configFile,
    mode: 'production',
    logLevel: 'silent',
    build: { write: false },
  })
  const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RolldownOutput[]
  const items = outputs.flatMap((output) => output.output)
  const modules: string[] = []
  const code: string[] = []
  let html = ''
  for (const item of items) {
    if (item.type === 'chunk') {
      modules.push(...item.moduleIds.map((id) => normalizePath(id)))
      code.push(item.code)
    } else if (item.fileName === 'index.html') {
      html = String(item.source)
    } else {
      code.push(typeof item.source === 'string' ? item.source : '')
    }
  }
  return { modules, code: code.join('\n'), html }
}

// Code lines of the classic inline script (comments and blank lines dropped).
function themeStatements(html: string): string[] {
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ''
  return script
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('//'))
}

// Module ids end in their file path; the repo-relative tail is what counts.
const tail = (id: string) => id.replace(/^.*?\/(frontend|desktop|node_modules)\//, '$1/')

/** Modules and strings that belong to the web transport only. */
export function webTransportTraces(bundle: Bundle): string[] {
  const found: string[] = []
  for (const id of bundle.modules.map(tail)) {
    if (/^node_modules\/(axios|pusher-js|laravel-echo)\//.test(id)) found.push(id)
    if (id.startsWith('frontend/src/platform/web/')) found.push(id)
    if (id === 'frontend/src/platform/runtime.ts' || id === 'frontend/src/app/extensions.tsx') found.push(id)
  }
  for (const text of ['/sanctum/csrf-cookie', 'X-XSRF-TOKEN', 'broadcasting/auth']) {
    if (bundle.code.includes(text)) found.push(text)
  }
  return found
}

describe('desktop bundle', () => {
  let bundle: Bundle

  beforeAll(async () => {
    bundle = await buildDesktop()
  }, 240_000)

  it('carries no web transport', () => {
    expect(bundle.modules.length).toBeGreaterThan(100)
    expect(webTransportTraces(bundle)).toEqual([])
  })

  it('carries the desktop runtime and extensions in place of the web ones', () => {
    const ids = bundle.modules.map(tail)
    expect(ids).toContain('desktop/src/platform/runtime.ts')
    expect(ids).toContain('desktop/src/app/extensions.tsx')
    expect(ids).toContain('frontend/src/platform/index.ts')
    expect(bundle.code).toContain('api_request')
  })

  it('opens the web app from desktop/src/main.tsx with the theme script first', () => {
    expect(bundle.modules.map(tail)).toContain('desktop/src/main.tsx')
    expect(bundle.html).toContain('<div id="root"></div>')
    const theme = bundle.html.indexOf("localStorage.getItem('keystone.theme')")
    const entry = bundle.html.indexOf('<script type="module"')
    expect(theme).toBeGreaterThan(-1)
    expect(entry).toBeGreaterThan(theme)
  })

  it('paints the theme with the same statements as the web page', () => {
    const webHtml = readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8')
    expect(themeStatements(bundle.html)).toEqual(themeStatements(webHtml))
    expect(themeStatements(webHtml).length).toBeGreaterThan(5)
  })

  it('has no inline style element or attribute in the page', () => {
    expect(bundle.html).not.toMatch(/<style[\s>]/)
    expect(bundle.html).not.toMatch(/\sstyle=/)
  })

  it('finds the traces it looks for', () => {
    expect(
      webTransportTraces({
        modules: [
          'C:/repo/node_modules/axios/lib/axios.js',
          '/repo/node_modules/pusher-js/dist/web/pusher.js',
          '/repo/node_modules/laravel-echo/dist/echo.js',
          '/repo/frontend/src/platform/web/http.ts',
          '/repo/frontend/src/platform/runtime.ts',
          '/repo/frontend/src/app/extensions.tsx',
          '/repo/frontend/src/platform/index.ts',
        ],
        code: "get('/sanctum/csrf-cookie'); h['X-XSRF-TOKEN']; post('broadcasting/auth')",
        html: '',
      }),
    ).toEqual([
      'node_modules/axios/lib/axios.js',
      'node_modules/pusher-js/dist/web/pusher.js',
      'node_modules/laravel-echo/dist/echo.js',
      'frontend/src/platform/web/http.ts',
      'frontend/src/platform/runtime.ts',
      'frontend/src/app/extensions.tsx',
      '/sanctum/csrf-cookie',
      'X-XSRF-TOKEN',
      'broadcasting/auth',
    ])
  })
})
