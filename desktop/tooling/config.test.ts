// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { normalizePath, type ConfigEnv, type UserConfig } from 'vite'
import { describe, expect, it } from 'vitest'

import config, { DEV_CSP, DEV_NONCE } from '../vite.desktop.config'

const here = (path: string) => normalizePath(fileURLToPath(new URL(path, import.meta.url)))

const tauriConf = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')) as {
  build: { devUrl: string; frontendDist: string }
  app: { security: { devCsp: string } }
}

function resolve(command: ConfigEnv['command']): UserConfig {
  if (typeof config !== 'function') throw new Error('vite.desktop.config.ts exports a config function')
  return config({ command, mode: command === 'build' ? 'production' : 'development' })
}

const pluginNames = (cfg: UserConfig) =>
  (cfg.plugins ?? []).flat().map((plugin) => (plugin && typeof plugin === 'object' && 'name' in plugin ? plugin.name : ''))

describe('vite.desktop.config.ts', () => {
  it('serves the dev window with the devCsp of tauri.conf.json', () => {
    const serve = resolve('serve')
    expect(DEV_CSP).toBe(tauriConf.app.security.devCsp)
    expect(serve.server?.headers).toEqual({ 'Content-Security-Policy': DEV_CSP })
    expect(`http://${String(serve.server?.host)}:${String(serve.server?.port)}`).toBe(tauriConf.build.devUrl)
    expect(serve.server?.strictPort).toBe(true)
  })

  it('gives Vite inline tags the devCsp nonce in dev only', () => {
    expect(DEV_NONCE).not.toBe('')
    expect(DEV_CSP).toContain(`'nonce-${DEV_NONCE}'`)
    expect(resolve('serve').html).toEqual({ cspNonce: DEV_NONCE })
    expect(resolve('build').html?.cspNonce).toBeUndefined()
  })

  it('builds from desktop/ into the frontendDist of tauri.conf.json', () => {
    const build = resolve('build')
    expect(normalizePath(String(build.root))).toBe(here('..'))
    expect(normalizePath(fileURLToPath(new URL(`../src-tauri/${tauriConf.build.frontendDist}`, import.meta.url)))).toBe(
      normalizePath(`${String(build.root)}/${String(build.build?.outDir)}`),
    )
  })

  it('lets the dev server read the web sources above desktop/', () => {
    const allow = (resolve('serve').server?.fs?.allow ?? []).map((path) => normalizePath(path))
    expect(allow).toEqual([here('../..')])
  })

  it('resolves @ to the web sources and @desktop to the desktop ones', () => {
    const alias = resolve('build').resolve?.alias as Record<string, string>
    expect(normalizePath(alias['@'] ?? '')).toBe(here('../../frontend/src'))
    expect(normalizePath(alias['@desktop'] ?? '')).toBe(here('../src'))
  })

  it('swaps modules before React and Tailwind see them', () => {
    const names = pluginNames(resolve('build'))
    expect(names[0]).toBe('keystone:module-swap')
    expect(names.some((name) => name.startsWith('vite:react'))).toBe(true)
    expect(names.some((name) => name.startsWith('@tailwindcss/vite'))).toBe(true)
  })
})
