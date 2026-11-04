import { appExtensions } from '@/app/extensions'

const NONE: ReadonlySet<string> = new Set()

/**
 * Ids of rows that carry a change not sent to the server yet. Always empty on web; a runtime
 * that answers lists from a local copy fills it through its `useDraftRows` extension.
 */
export function useDraftRows(): ReadonlySet<string> {
  return appExtensions.useDraftRows?.() ?? NONE
}
