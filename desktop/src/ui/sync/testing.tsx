// Test harness for the sync screens: real web components, i18n, React Query and
// a memory router around them; platform pieces from the fake bridge.
/* eslint-disable react-refresh/only-export-components -- test harness, never hot-reloaded */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import i18next from 'i18next'
import { useEffect, type ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router'
import { vi } from 'vitest'

import type { OfflineMeta } from '../../platform'
import type { OfflineMetaSource, SyncBridge, SyncDeps } from '../../sync'
import { addDesktopResources, DESKTOP_NS } from '../../i18n'
import { SyncDepsProvider } from './context'
import type { Connectivity, HttpClient } from '@/platform/types'

export function fakeConnectivity(online = true) {
  let current = online
  const listeners = new Set<(online: boolean) => void>()
  const value: Connectivity = {
    isOnline: () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return {
    value,
    set(next: boolean) {
      current = next
      for (const listener of [...listeners]) listener(next)
    },
  }
}

export function fakeOfflineMeta() {
  const entries = new Map<string, OfflineMeta>()
  const listeners = new Set<(path: string) => void>()
  const value: OfflineMetaSource = {
    get: (path) => entries.get(path),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return {
    value,
    record(path: string, meta: OfflineMeta | undefined) {
      if (meta) entries.set(path, meta)
      else entries.delete(path)
      for (const listener of [...listeners]) listener(path)
    },
  }
}

export function fakeNotify() {
  return { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }
}

function Where({ onNavigate }: { onNavigate: (go: (path: string) => void) => void }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    onNavigate((path) => void navigate(path))
  }, [onNavigate, navigate])
  return <output data-testid="location">{pathname}</output>
}

export interface Harness {
  client: QueryClient
  notify: ReturnType<typeof fakeNotify>
  http: HttpClient
  i18n: typeof i18next
  /** Navigates inside the memory router. */
  go: (path: string) => void
}

export async function renderSync(
  ui: ReactNode,
  options: {
    bridge?: SyncBridge | null
    connectivity?: Connectivity
    offlineMeta?: OfflineMetaSource | null
    http?: Partial<HttpClient>
    path?: string
    /** Extra desktop-namespace text (e.g. error codes before P5 adds them). */
    text?: Record<string, unknown>
  } = {},
): Promise<Harness> {
  const i18n = i18next.createInstance()
  await i18n.init({ lng: 'tr', fallbackLng: 'tr', resources: {} })
  addDesktopResources(i18n)
  if (options.text) i18n.addResourceBundle('tr', DESKTOP_NS, options.text, true, true)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const notify = fakeNotify()
  const http = { get: vi.fn(), ...options.http } as unknown as HttpClient
  const deps: SyncDeps = {
    bridge: options.bridge ?? null,
    connectivity: options.connectivity ?? fakeConnectivity().value,
    offlineMeta: options.offlineMeta ?? null,
    http,
    notify,
  }
  const path = options.path ?? '/'
  let go: (path: string) => void = () => undefined
  const onNavigate = (next: (path: string) => void) => {
    go = next
  }
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <SyncDepsProvider deps={deps}>
            <Routes>
              {/* One route for every path: a navigation keeps the screen mounted. */}
              <Route
                path="*"
                element={
                  <>
                    {ui}
                    <Where onNavigate={onNavigate} />
                  </>
                }
              />
            </Routes>
          </SyncDepsProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
  return { client, notify, http, i18n, go: (to) => {
    go(to)
  } }
}
