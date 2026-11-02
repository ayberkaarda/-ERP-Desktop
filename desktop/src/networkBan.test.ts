// @vitest-environment node
import { fileURLToPath } from 'node:url'

import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'

// Runs desktop/eslint.config.js on in-memory sources. Only the network-ban
// rules run, so no type information (and no file on disk) is needed.
const desktopDir = fileURLToPath(new URL('..', import.meta.url))
const BAN_RULES = new Set(['no-restricted-imports', 'no-restricted-syntax', 'no-restricted-globals'])

let eslint: ESLint

beforeAll(() => {
  eslint = new ESLint({
    cwd: desktopDir,
    overrideConfigFile: `${desktopDir}eslint.config.js`,
    overrideConfig: {
      languageOptions: { parserOptions: { projectService: false } },
    },
    ruleFilter: ({ ruleId }) => BAN_RULES.has(ruleId),
  })
})

async function banHits(code: string, file: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: `${desktopDir}${file}` })
  if (!result) throw new Error('no lint result')
  const fatal = result.messages.filter((m) => m.fatal)
  if (fatal.length > 0) throw new Error(fatal.map((m) => m.message).join('; '))
  return result.messages.map((m) => m.ruleId ?? '')
}

const BLOCKED: [string, string][] = [
  ['bare fetch', "void fetch('/x')"],
  ['window.fetch', "void window.fetch('/x')"],
  ['globalThis.fetch', "void globalThis.fetch('/x')"],
  ['self.fetch', "void self.fetch('/x')"],
  ["window['fetch']", "void window['fetch']('/x')"],
  ['XMLHttpRequest', 'void new XMLHttpRequest()'],
  ['WebSocket', "void new WebSocket('ws://x')"],
  ['EventSource', "void new EventSource('/x')"],
  ['navigator.sendBeacon', "navigator.sendBeacon('/x')"],
  ['window.navigator.sendBeacon', "window.navigator.sendBeacon('/x')"],
  ['globalThis.navigator.sendBeacon', "globalThis.navigator.sendBeacon('/x')"],
  ['alias of window', "const w = window\nvoid w.fetch('/x')"],
  ['cast of window', "void (window as unknown as { fetch: typeof fetch }).fetch('/x')"],
  ['optional chain', "void document.defaultView?.fetch('/x')"],
  ['import axios', "import axios from 'axios'\nvoid axios"],
  ['axios subpath', "import a from 'axios/unsafe/axios.js'\nvoid a"],
  ['ky', "import ky from 'ky'\nvoid ky"],
  ['pusher-js', "import Pusher from 'pusher-js'\nvoid Pusher"],
  ['pusher-js subpath', "import P from 'pusher-js/dist/web/pusher.js'\nvoid P"],
  ['laravel-echo', "import Echo from 'laravel-echo'\nvoid Echo"],
  ['dynamic import laravel-echo', "void import('laravel-echo')"],
  ['dynamic import axios', "void import('axios')"],
  ['template import', 'void import(`axios`)'],
  ['concatenated import', "void import('ax' + 'ios')"],
  ['plugin-http', "import { fetch as f } from '@tauri-apps/plugin-http'\nvoid f"],
  ['plugin-websocket', "import ws from '@tauri-apps/plugin-websocket'\nvoid ws"],
  ['plugin-upload', "import { upload } from '@tauri-apps/plugin-upload'\nvoid upload"],
  ['plugin-shell', "import { open } from '@tauri-apps/plugin-shell'\nvoid open"],
]

const ALLOWED = [
  "import { invoke } from '@tauri-apps/api/core'\nvoid invoke('app_info')",
  "import { listen } from '@tauri-apps/api/event'\nvoid listen('engine-event', () => undefined)",
  "void Promise.resolve(1).then((n) => n + 1)",
  "void import('./i18n')",
  "const q = { fetchQuery: () => 1 }\nvoid q.fetchQuery()",
]

// Known bypasses: the rule does not catch these. The real control is the
// webview CSP (connect-src ipc: http://ipc.localhost). If one starts to fail
// here, the rule got stronger: move it to BLOCKED.
const KNOWN_BYPASSES: [string, string][] = [
  ['computed key in a variable', "const k = 'fetch'\nvoid (window as unknown as Record<string, () => void>)[k]?.()"],
  ['Reflect.get', "void Reflect.get(globalThis, 'fetch')"],
  ['image beacon', "new Image().src = 'https://example.com/x'"],
]

describe.each(['src/probe.ts', 'src/ui/probe.tsx'])('network ban in %s', (file) => {
  it.each(BLOCKED)('blocks %s', async (_name, code) => {
    expect((await banHits(code, file)).length).toBeGreaterThan(0)
  })

  it.each(ALLOWED)('allows %s', async (code) => {
    expect(await banHits(code, file)).toEqual([])
  })

  it.each(KNOWN_BYPASSES)('does not catch %s (known bypass)', async (_name, code) => {
    expect(await banHits(code, file)).toEqual([])
  })
})

describe('network ban scope', () => {
  it('does not apply outside src/', async () => {
    expect(await banHits("void fetch('/x')", 'scripts/probe.ts')).toEqual([])
  })
})
