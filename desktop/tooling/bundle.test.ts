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
  css: string
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
  const css: string[] = []
  let html = ''
  for (const item of items) {
    if (item.type === 'chunk') {
      modules.push(...item.moduleIds.map((id) => normalizePath(id)))
      code.push(item.code)
    } else if (item.fileName === 'index.html') {
      html = String(item.source)
    } else {
      const text = typeof item.source === 'string' ? item.source : ''
      code.push(text)
      if (item.fileName.endsWith('.css')) css.push(text)
    }
  }
  return { modules, code: code.join('\n'), html, css: css.join('\n') }
}

// Script elements of a page: inline ones (no src) and the src of the others.
function scripts(html: string): { inline: number; sources: string[] } {
  const tags = html.match(/<script\b[^>]*>/gi) ?? []
  const sources = tags.flatMap((tag) => /\ssrc\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1] ?? [])
  return { inline: tags.length - sources.length, sources }
}

// Every src= and href= of the page.
const urls = (html: string) => [...html.matchAll(/\s(?:src|href)\s*=\s*["']?([^"'\s>]+)/gi)].map((match) => match[1] ?? '')

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

// A web transport package wherever npm installed it: hoisted to the root or
// nested under a workspace (frontend/node_modules/axios when versions differ).
const NET_PACKAGE = /\/(node_modules\/(?:axios|pusher-js|laravel-echo)\/.*)$/

/** Modules and strings that belong to the web transport only. */
export function webTransportTraces(bundle: Pick<Bundle, 'modules' | 'code'>): string[] {
  const found: string[] = []
  for (const module of bundle.modules) {
    const id = tail(module)
    const net = NET_PACKAGE.exec(`/${module}`)?.[1]
    if (net !== undefined) found.push(net)
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
          // Nested installs, as npm places a version the root does not have.
          'C:/repo/frontend/node_modules/axios/lib/core/Axios.js',
          '/repo/desktop/node_modules/pusher-js/dist/web/pusher.js',
          'C:/repo/frontend/node_modules/laravel-echo/dist/echo.js',
        ],
        code: "get('/sanctum/csrf-cookie'); h['X-XSRF-TOKEN']; post('broadcasting/auth')",
      }),
    ).toEqual([
      'node_modules/axios/lib/axios.js',
      'node_modules/pusher-js/dist/web/pusher.js',
      'node_modules/laravel-echo/dist/echo.js',
      'frontend/src/platform/web/http.ts',
      'frontend/src/platform/runtime.ts',
      'frontend/src/app/extensions.tsx',
      'node_modules/axios/lib/core/Axios.js',
      'node_modules/pusher-js/dist/web/pusher.js',
      'node_modules/laravel-echo/dist/echo.js',
      '/sanctum/csrf-cookie',
      'X-XSRF-TOKEN',
      'broadcasting/auth',
    ])
  })

  // Tauri adds the hash of every inline script to script-src, so a second
  // inline script would run in the release window too. The theme script is
  // the only one; the rest is the bundle's own files.
  it('runs the theme script inline and nothing else from outside the bundle', () => {
    const page = scripts(bundle.html)
    expect(page.inline).toBe(1)
    expect(page.sources.length).toBeGreaterThan(0)
    for (const url of urls(bundle.html)) {
      expect(url, url).toMatch(/^\/(?!\/)/)
    }
  })

  it('counts inline and remote scripts', () => {
    const html =
      '<script>a()</script><script type="module" src="/assets/i.js"></script>' +
      '<SCRIPT>b()</SCRIPT><script src="https://cdn.example.com/x.js"></script><link href="//cdn.example.com/y.css">'
    expect(scripts(html)).toEqual({ inline: 2, sources: ['/assets/i.js', 'https://cdn.example.com/x.js'] })
    expect(urls(html)).toEqual(['/assets/i.js', 'https://cdn.example.com/x.js', '//cdn.example.com/y.css'])
  })

  // Thresholds are selectors, not byte sizes: each one goes missing when its
  // source does (@source of the web sources, the web stylesheet, sonner, fonts).
  it('styles the web components, toasts and fonts', () => {
    // Utilities only the web sources use (AppShell top bar, Sidebar, Button
    // control height, report grids): Tailwind emits them through
    // `@source '../../frontend/src'` in src/styles.css. The names are put
    // together at run time: Tailwind also scans desktop/ (this file), and a
    // literal class name here would emit the rule by itself.
    const utilities: [string, string][] = [
      ['h', 'topbar'],
      ['w', 'sidebar'],
      ['h', 'control'],
      ['grid-cols', '2'],
    ]
    for (const [utility, value] of utilities) {
      const selector = `.${utility}-${value}{`
      expect(bundle.css, selector).toContain(selector)
    }
    // Design tokens of frontend/src/styles/tokens.css, through src/styles.css.
    for (const token of ['--brand-accent:', '--chart-grid:']) {
      expect(bundle.css, token).toContain(token)
    }
    // sonner/dist/styles.css (the run-time copy is refused by style-src).
    expect(bundle.css).toContain('[data-sonner-toaster]')
    // The three fontsource imports of main.tsx.
    for (const face of [
      /@font-face\{font-family:IBM Plex Sans Variable;[^}]*font-weight:100 700/,
      /@font-face\{font-family:IBM Plex Mono;[^}]*font-weight:400;/,
      /@font-face\{font-family:IBM Plex Mono;[^}]*font-weight:500;/,
    ]) {
      expect(bundle.css).toMatch(face)
    }
  })
})
