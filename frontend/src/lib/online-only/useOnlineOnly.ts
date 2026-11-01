import { appExtensions } from '@/app/extensions'

export interface OnlineOnlyState {
  disabled: boolean
  /** Already translated; shown as the disabled control's tooltip. */
  reason?: string
}

const AVAILABLE: OnlineOnlyState = { disabled: false }

/**
 * Whether a server-only action (finalize, approve, post, ...) can run now. Always available
 * on web; a runtime with an offline mode answers through its `useOnlineOnly` extension.
 */
export function useOnlineOnly(action: string): OnlineOnlyState {
  return appExtensions.useOnlineOnly?.(action) ?? AVAILABLE
}
