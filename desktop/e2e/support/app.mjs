// One run of the desktop app under tauri-driver: its own data directory (so
// every spec file starts from a first run), the server stack, sign-in through
// the app's own screens, and the waits the scenarios share.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createProxy, loadState, PROXY_URL, requiredEnv, startServer } from './stack.mjs'
import { AppSession, startDriver, waitFor } from './webdriver.mjs'

/**
 * Windows has no XDG override: the app keeps its data and the webview profile under
 * %APPDATA% and %LOCALAPPDATA% of the user. On a CI runner (never on a developer
 * machine) clear them, so that every spec file starts from a first run as on Linux.
 */
function resetWindowsAppData() {
  if (process.platform !== 'win32' || process.env.CI !== 'true') return
  for (const root of [process.env.APPDATA, process.env.LOCALAPPDATA]) {
    if (root) rmSync(join(root, 'com.keystone.desktop'), { recursive: true, force: true })
  }
}

export async function launch() {
  resetWindowsAppData()
  const state = loadState()
  const dataDir = mkdtempSync(join(tmpdir(), 'keystone-e2e-'))
  const server = await startServer()
  const proxy = createProxy()
  await proxy.restore()
  const driver = await startDriver({
    XDG_DATA_HOME: join(dataDir, 'data'),
    XDG_CACHE_HOME: join(dataDir, 'cache'),
    KEYSTONE_DEV_ALLOW_HTTP: '1',
  })
  let session
  try {
    session = await AppSession.create(requiredEnv('E2E_APP_BIN'))
  } catch (error) {
    await driver.stop()
    await server.stop()
    throw error
  }
  const app = {
    state,
    session,
    proxy,
    status: () => session.invoke('sync_status'),
    /** The app's own offline detection: ask for a run, then wait for the state. */
    async waitForState(wanted, timeout = 45_000) {
      await session.invoke('sync_now').catch(() => undefined)
      return waitFor(async () => (await app.status()).state === wanted, { timeout, message: `sync state ${wanted}` })
    },
    async stop() {
      await session?.close().catch(() => undefined)
      await driver.stop()
      await proxy.cut()
      await server.stop()
      rmSync(dataDir, { recursive: true, force: true })
    },
  }
  return app
}

/** First run: add the server profile (through the proxy), then sign in on the login screen. */
export async function signIn(app, email) {
  const { session, state } = app
  try {
    await session.waitForElement('[data-testid="profiles-page"]', { timeout: 60_000 })
    await session.type('[data-testid="profile-url"]', PROXY_URL)
    await session.type('[data-testid="profile-name"]', 'e2e server')
    await session.tap('[data-testid="profile-add"]')
    await session.waitForElement('[data-testid="login-email"]', { timeout: 30_000 })
    await session.type('[data-testid="login-email"]', email)
    await session.type('[data-testid="login-password"]', state.password)
    await session.tap('[data-testid="login-submit"]')
    await waitFor(
      async () => {
        const path = await session.execute('return location.pathname')
        return path !== '/login' && path !== '/setup'
      },
      { timeout: 60_000, message: 'the app to leave the login screen' },
    )
  } catch (error) {
    error.message += `\n--- page ---\n${await session.describe()}`
    throw error
  }
}

/** Local-first reads answer once the first pull has run: poll until the seeded customer is there. */
export function waitForSeedData(app) {
  const { session, state } = app
  return waitFor(
    async () => {
      const answer = await session.api('GET', '/api/v1/parties')
      return answer.status === 200 && JSON.stringify(answer.json).includes(state.party.name)
    },
    { timeout: 90_000, interval: 1_000, message: 'the first pull to bring the seeded customer' },
  )
}
