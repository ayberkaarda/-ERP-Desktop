// Same toasts as the web `createWebNotify` (sonner).

import { toast } from 'sonner'

import type { Notify } from './u1-shim'

export function createDesktopNotify(): Notify {
  return {
    success: (message, o) => toast.success(message, o),
    info: (message, o) => toast.info(message, o),
    warning: (message, o) => toast.warning(message, o),
    error: (message, o) => toast.error(message, o),
  }
}
