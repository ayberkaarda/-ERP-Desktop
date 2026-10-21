import { platform } from '@/platform'
import type { SalesWarning } from '../types'

/** Shows server warnings of a save or action as one toast. */
export function notifyWarnings(warnings: readonly SalesWarning[]) {
  if (warnings.length === 0) return
  platform.notify.warning(warnings.map((w) => w.message).join(' '))
}
