// The desktop answer to the web `useOnlineOnly(action)`: offline, a server-only
// action is disabled and its tooltip says why (`desktop.onlineOnly.<action>`).

import { useCallback, useSyncExternalStore } from 'react'

import { useDesktopText } from './text'
import type { OnlineOnlyState } from '@/lib/online-only'
import type { Connectivity } from '@/platform/types'

const AVAILABLE: OnlineOnlyState = { disabled: false }

const noSubscription = () => () => undefined

/** `connectivity` is `null` until the desktop platform is known: available. */
export function useOnlineOnlyState(connectivity: Connectivity | null, action: string): OnlineOnlyState {
  const subscribe = useCallback(
    (onChange: () => void) => (connectivity ? connectivity.subscribe(onChange) : noSubscription()),
    [connectivity],
  )
  const online = useSyncExternalStore(subscribe, () => connectivity?.isOnline() ?? true)
  const text = useDesktopText()
  return online ? AVAILABLE : { disabled: true, reason: text.onlineOnly(action) }
}
