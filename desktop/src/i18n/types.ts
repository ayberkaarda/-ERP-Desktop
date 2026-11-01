import type account from './locales/tr/account.json'
import type errors from './locales/tr/errors.json'
import type onlineOnly from './locales/tr/onlineOnly.json'
import type shell from './locales/tr/shell.json'
import type sync from './locales/tr/sync.json'

// Turkish is the source of truth: the key type comes from the tr files and
// every other language must provide the same shape.
export interface DesktopResources {
  shell: typeof shell
  sync: typeof sync
  account: typeof account
  errors: typeof errors
  onlineOnly: typeof onlineOnly
}

export type DesktopSection = keyof DesktopResources

type LeafKeys<T, Prefix extends string> = T extends string
  ? Prefix
  : T extends object
    ? { [K in keyof T & string]: LeafKeys<T[K], `${Prefix}.${K}`> }[keyof T & string]
    : never

// Dotted leaf keys inside the desktop namespace, e.g. "shell.appName".
export type DesktopKey = {
  [S in DesktopSection]: LeafKeys<DesktopResources[S], S>
}[DesktopSection]
