import type { AppExtensions } from '@/app/extensions'

/** What one desktop package contributes to the web app's extension points. */
export type ExtensionPart = Partial<AppExtensions>

export type Slot = Exclude<keyof AppExtensions, 'routes' | 'publicRoutes'>

export const SLOTS = [
  'LoginPage',
  'PasswordChangePage',
  'SecurityExtras',
  'HeaderExtras',
  'useOnlineOnly',
] as const satisfies readonly Slot[]

/**
 * Joins the parts into one `AppExtensions`: route lists are concatenated in
 * part order, each single slot may be filled by one part only (a second one
 * is a wiring mistake and throws at start-up rather than silently winning).
 */
export function composeExtensions(parts: readonly (readonly [name: string, part: ExtensionPart])[]): AppExtensions {
  const result: AppExtensions = { routes: [], publicRoutes: [] }
  const owners = new Map<Slot, string>()
  for (const [name, part] of parts) {
    result.routes.push(...(part.routes ?? []))
    result.publicRoutes.push(...(part.publicRoutes ?? []))
    for (const slot of SLOTS) {
      if (part[slot] === undefined) continue
      const owner = owners.get(slot)
      if (owner !== undefined) {
        throw new Error(`appExtensions.${slot} is set by both ${owner} and ${name}`)
      }
      owners.set(slot, name)
      Object.assign(result, { [slot]: part[slot] })
    }
  }
  return result
}
