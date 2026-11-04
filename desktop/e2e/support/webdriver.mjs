// A small W3C WebDriver client for tauri-driver (no dependencies): the
// session, element commands, script execution, and the Tauri IPC from inside
// the webview (`window.__TAURI_INTERNALS__.invoke`, the call the app's own
// bridge makes).
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf'
const DRIVER_PORT = 4444

export async function waitFor(check, { timeout = 30_000, interval = 250, message = 'condition' } = {}) {
  const deadline = Date.now() + timeout
  let last
  for (;;) {
    try {
      const value = await check()
      if (value) return value
      last = undefined
    } catch (error) {
      last = error
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out after ${timeout} ms waiting for ${message}${last ? `: ${last.message}` : ''}`)
    }
    await sleep(interval)
  }
}

/** Starts tauri-driver (which starts WebKitWebDriver) with the given environment. */
export async function startDriver(env) {
  const child = spawn('tauri-driver', ['--port', String(DRIVER_PORT)], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  const exited = new Promise((resolve) => child.once('exit', resolve))
  await waitFor(
    async () => {
      if (child.exitCode !== null) throw new Error(`tauri-driver exited with ${child.exitCode}`)
      const response = await fetch(`http://127.0.0.1:${DRIVER_PORT}/status`)
      return response.ok
    },
    { timeout: 30_000, message: 'tauri-driver to answer /status' },
  )
  return {
    async stop() {
      child.kill('SIGTERM')
      await Promise.race([exited, sleep(5_000)])
      if (child.exitCode === null) child.kill('SIGKILL')
    },
  }
}

export class AppSession {
  constructor(id) {
    this.id = id
  }

  static async create(application) {
    const response = await fetch(`http://127.0.0.1:${DRIVER_PORT}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        capabilities: { alwaysMatch: { browserName: 'wry', 'tauri:options': { application } } },
      }),
    })
    const body = await response.json()
    if (!response.ok) throw new Error(`new session: ${response.status} ${JSON.stringify(body)}`)
    return new AppSession(body.value.sessionId)
  }

  async command(method, path, body) {
    const response = await fetch(`http://127.0.0.1:${DRIVER_PORT}/session/${this.id}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body ?? {}),
    })
    const parsed = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(parsed.value ?? parsed)}`)
    return parsed.value
  }

  async close() {
    await this.command('DELETE', '')
  }

  /** Runs `body` in the page; `args` are available as `arguments`. */
  execute(body, ...args) {
    return this.command('POST', '/execute/sync', { script: body, args })
  }

  /** Like `execute`, with the completion callback as the last argument. */
  executeAsync(body, ...args) {
    return this.command('POST', '/execute/async', { script: body, args })
  }

  async find(selector) {
    const found = await this.command('POST', '/element', { using: 'css selector', value: selector })
    return found[ELEMENT_KEY]
  }

  /** The element once it exists. */
  waitForElement(selector, options = {}) {
    return waitFor(() => this.find(selector).catch(() => null), {
      message: `element ${selector}`,
      ...options,
    })
  }

  click(element) {
    return this.command('POST', `/element/${element}/click`)
  }

  async type(selector, text) {
    const element = await this.waitForElement(selector)
    await this.command('POST', `/element/${element}/clear`)
    await this.command('POST', `/element/${element}/value`, { text })
  }

  async tap(selector) {
    await this.click(await this.waitForElement(selector))
  }

  /** A Tauri command, as the app's bridge calls it; a rejection becomes an Error with the code. */
  async invoke(command, args = {}) {
    const result = await this.executeAsync(
      `const [command, args, done] = arguments
       window.__TAURI_INTERNALS__.invoke(command, args).then(
         (value) => done({ ok: value ?? null }),
         (reason) => done({ err: reason && typeof reason === 'object' ? reason : { message: String(reason) } }),
       )`,
      command,
      args,
    )
    if ('err' in result) {
      const error = new Error(`${command}: ${JSON.stringify(result.err)}`)
      error.code = result.err.code
      throw error
    }
    return result.ok
  }

  /** `api_request` as the web code issues it; resolves to `{status, json, source}`. */
  async api(method, path, { query, body, headers } = {}) {
    const req = {
      method,
      path,
      ...(query ? { query } : {}),
      ...(headers ? { headers } : {}),
      ...(body === undefined ? {} : { body: { kind: 'json', value: body } }),
    }
    const answer = await this.invoke('api_request', { req })
    return {
      status: answer.status,
      json: answer.body?.kind === 'json' ? answer.body.value : null,
      source: answer.source,
    }
  }

  /** Client-side navigation inside the running app (no reload). */
  navigate(path) {
    return this.execute(
      `history.pushState({}, '', arguments[0]); window.dispatchEvent(new PopStateEvent('popstate'))`,
      path,
    )
  }

  /** What the page shows, for failure reports. */
  async describe() {
    try {
      return await this.execute(`return location.href + '\\n' + document.body.innerText.slice(0, 1500)`)
    } catch (error) {
      return `(page unreadable: ${error.message})`
    }
  }
}
