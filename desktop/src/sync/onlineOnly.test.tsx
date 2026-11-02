import { act, renderHook } from '@testing-library/react'
import i18next from 'i18next'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'

import { addDesktopResources } from '../i18n'
import { useOnlineOnlyState } from './onlineOnly'
import type { Connectivity } from '@/platform/types'

function connectivity(start: boolean) {
  let online = start
  const listeners = new Set<(online: boolean) => void>()
  const value: Connectivity = {
    isOnline: () => online,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return {
    value,
    set: (next: boolean) => {
      online = next
      for (const listener of [...listeners]) listener(next)
    },
    listeners: () => listeners.size,
  }
}

async function wrapper() {
  const i18n = i18next.createInstance()
  await i18n.init({ lng: 'tr', fallbackLng: 'tr', resources: {} })
  addDesktopResources(i18n)
  return function Wrapper({ children }: { children: ReactNode }) {
    return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
  }
}

describe('useDesktopOnlineOnly', () => {
  it('is available online', async () => {
    const net = connectivity(true)
    const { result } = renderHook(() => useOnlineOnlyState(net.value, 'closePeriod'), { wrapper: await wrapper() })
    expect(result.current).toEqual({ disabled: false })
  })

  it('is disabled offline with the action text as reason', async () => {
    const net = connectivity(false)
    const { result } = renderHook(() => useOnlineOnlyState(net.value, 'closePeriod'), { wrapper: await wrapper() })
    expect(result.current).toEqual({ disabled: true, reason: 'Dönem ve mali yıl kapanışı çevrimiçi yapılır.' })
  })

  it('an action without its own text gets the general reason', async () => {
    const net = connectivity(false)
    const { result } = renderHook(() => useOnlineOnlyState(net.value, 'notAnAction'), { wrapper: await wrapper() })
    expect(result.current).toEqual({ disabled: true, reason: 'Bu işlem yalnız çevrimiçiyken yapılabilir.' })
  })

  it('follows connection changes', async () => {
    const net = connectivity(true)
    const { result, unmount } = renderHook(() => useOnlineOnlyState(net.value, 'closePeriod'), { wrapper: await wrapper() })
    act(() => {
      net.set(false)
    })
    expect(result.current.disabled).toBe(true)
    act(() => {
      net.set(true)
    })
    expect(result.current.disabled).toBe(false)
    unmount()
    expect(net.listeners()).toBe(0)
  })

  it('without a desktop platform the action stays available', async () => {
    const { result } = renderHook(() => useOnlineOnlyState(null, 'closePeriod'), { wrapper: await wrapper() })
    expect(result.current).toEqual({ disabled: false })
  })
})
