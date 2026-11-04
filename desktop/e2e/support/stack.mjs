// The server side of a scenario run: the Laravel server (a real one, on the
// database the workflow seeded), a TCP proxy in front of it that the desktop
// profile points at (cutting it is the network cut), and the seeded state.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import net from 'node:net'
import { resolve } from 'node:path'

import { waitFor } from './webdriver.mjs'

export const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 8000)
export const PROXY_PORT = Number(process.env.E2E_PROXY_PORT ?? 8001)
export const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`
export const PROXY_URL = `http://127.0.0.1:${PROXY_PORT}`

export function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set (the desktop-e2e workflow sets it)`)
  return value
}

export function loadState() {
  return JSON.parse(readFileSync(requiredEnv('E2E_STATE'), 'utf8'))
}

function portFree() {
  return new Promise((done) => {
    const probe = net.createServer()
    probe.once('error', () => done(false))
    probe.listen(SERVER_PORT, '127.0.0.1', () => probe.close(() => done(true)))
  })
}

/** `php artisan serve` on the seeded database, killed as a process group. */
export async function startServer() {
  const backend = resolve(requiredEnv('E2E_BACKEND_DIR'))
  const child = spawn('php', ['artisan', 'serve', '--no-reload', '--host=127.0.0.1', `--port=${SERVER_PORT}`], {
    cwd: backend,
    detached: true,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, PHP_CLI_SERVER_WORKERS: '4' },
  })
  await waitFor(async () => (await fetch(`${SERVER_URL}/api/v1/meta`)).ok, {
    timeout: 60_000,
    message: 'the Laravel server to answer /api/v1/meta',
  })
  return {
    async stop() {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        // already gone
      }
      // Wait until the port is free, so the next start cannot meet "address in use".
      await waitFor(() => portFree(), { timeout: 15_000, interval: 100, message: `port ${SERVER_PORT} to be free` })
    },
  }
}

/** A forwarding TCP proxy; `cut()` refuses connections and drops open ones, `restore()` listens again. */
export function createProxy() {
  const sockets = new Set()
  let server = null

  const track = (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.on('error', () => socket.destroy())
  }

  return {
    restore() {
      if (server) return Promise.resolve()
      return new Promise((done, fail) => {
        const listener = net.createServer((client) => {
          const upstream = net.connect(SERVER_PORT, '127.0.0.1')
          track(client)
          track(upstream)
          client.pipe(upstream)
          upstream.pipe(client)
        })
        listener.once('error', fail)
        listener.listen(PROXY_PORT, '127.0.0.1', () => {
          server = listener
          done()
        })
      })
    },
    async cut() {
      for (const socket of sockets) socket.destroy()
      const listener = server
      server = null
      if (listener) await new Promise((done) => listener.close(done))
    },
  }
}

/** The web side: the REST API as the super admin of the seed (a bearer token, like any API client). */
export function webApi(state) {
  return async (method, path, body) => {
    const headers = {
      accept: 'application/json',
      authorization: `Bearer ${state.root_token}`,
      'x-company-id': state.company_id,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(method === 'POST' ? { 'idempotency-key': crypto.randomUUID() } : {}),
    }
    const response = await fetch(`${SERVER_URL}/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = await response.json().catch(() => null)
    return { status: response.status, json }
  }
}
