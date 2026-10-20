import { toast } from 'sonner'
import type { Notify } from '../types'

export function createWebNotify(): Notify {
  return {
    success: (message, o) => toast.success(message, o),
    info: (message, o) => toast.info(message, o),
    warning: (message, o) => toast.warning(message, o),
    error: (message, o) => toast.error(message, o),
  }
}
