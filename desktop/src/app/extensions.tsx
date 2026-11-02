// Desktop counterpart of the web `frontend/src/app/extensions.tsx`: the desktop
// build swaps that module for this one (tooling/swaps.ts), so the web router,
// AppShell, SecurityPage and useOnlineOnly read these values.
//
// Each desktop UI package contributes one part through its index.ts:
//   - ui/sync (P2): HeaderExtras (sync, pending and conflict badges),
//     routes (/sync/outbox, /sync/conflicts), useOnlineOnly.
//   - ui/account (P3): LoginPage, PasswordChangePage, SecurityExtras,
//     publicRoutes (/setup), routes (profiles).
// A package adds `export const <name>Extensions: ExtensionPart` to its
// index.ts and one entry to PARTS below. The start-up gate around the router
// (P3 AppGate) is not an extension point: it goes in ./root.tsx.

import type { AppExtensions } from '@/app/extensions'

import { syncExtensions } from '../ui/sync'
import { composeExtensions, type ExtensionPart } from './compose'

export const PARTS: readonly (readonly [name: string, part: ExtensionPart])[] = [
  ['ui/sync', syncExtensions],
]

export const appExtensions: AppExtensions = composeExtensions(PARTS)
