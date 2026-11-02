// Route -> online-only action, from `online_only[].routes` of the offline
// manifest. Paths match templates by the rule of the shell router
// (src-tauri/src/router/decide.rs): same method, same number of segments,
// literal segments equal, a `{param}` segment matches a UUID only.

import { API_PREFIX, ONLINE_ONLY } from './generated/onlineOnly'

export type OnlineOnlyEntry = (typeof ONLINE_ONLY)[number]
export type OnlineOnlyAction = OnlineOnlyEntry['action']
export type OnlineOnlyCategory = OnlineOnlyEntry['category']
/** Key of the action's text for `td()`: "onlineOnly.<action>". */
export type OnlineOnlyKey = `onlineOnly.${OnlineOnlyAction}`

export interface OnlineOnlyMatch {
  action: OnlineOnlyAction
  category: OnlineOnlyCategory
  key: OnlineOnlyKey
  /** The manifest route that matched, e.g. "POST /api/v1/sales-quotes/{id}/send". */
  route: string
}

export const ONLINE_ONLY_ACTIONS: readonly OnlineOnlyAction[] = ONLINE_ONLY.map((entry) => entry.action)

type Segment = { literal: string } | { param: true }

interface Route {
  method: string
  segments: Segment[]
  entry: OnlineOnlyEntry
  route: string
}

const HEX = '[0-9a-fA-F]'
const HYPHENATED = `${HEX}{8}-${HEX}{4}-${HEX}{4}-${HEX}{4}-${HEX}{12}`
// The shapes `uuid::Uuid::try_parse` accepts: simple, hyphenated, braced, URN.
const UUID = new RegExp(`^(?:${HEX}{32}|${HYPHENATED}|\\{${HYPHENATED}\\}|[uU][rR][nN]:[uU][uU][iI][dD]:${HYPHENATED})$`)

/** Same test as `Segment::Param` in the shell router (`Uuid::try_parse`). */
export function isRouterUuid(segment: string): boolean {
  return UUID.test(segment)
}

const PREFIX = `${API_PREFIX}/`

function compile(entry: OnlineOnlyEntry, route: string): Route {
  const [method, template, ...rest] = route.split(' ')
  if (method === undefined || template === undefined || rest.length > 0 || !template.startsWith(PREFIX)) {
    throw new Error(`online_only ${entry.action}: malformed route "${route}"`)
  }
  const segments = template
    .slice(PREFIX.length)
    .split('/')
    .map((part): Segment => (part.startsWith('{') && part.endsWith('}') ? { param: true } : { literal: part }))
  if (segments.some((s) => 'literal' in s && s.literal === '')) {
    throw new Error(`online_only ${entry.action}: empty segment in "${route}"`)
  }
  return { method, segments, entry, route }
}

const ROUTES: readonly Route[] = ONLINE_ONLY.flatMap((entry) =>
  entry.routes.map((route) => compile(entry, route)),
)

function matches(route: Route, method: string, parts: readonly string[]): boolean {
  return (
    route.method === method &&
    route.segments.length === parts.length &&
    route.segments.every((segment, i) => {
      const part = parts[i] ?? ''
      return 'param' in segment ? isRouterUuid(part) : segment.literal === part
    })
  )
}

/**
 * The online-only action a request belongs to, or null. `path` is either the
 * full path ("/api/v1/sales-quotes/<uuid>/send") or the path the web features
 * pass to `platform.http` ("/sales-quotes/<uuid>/send"); a query string or
 * fragment is ignored. More than one match (the table forbids it) is null,
 * like the shell router.
 */
export function onlineOnlyAction(method: string, path: string): OnlineOnlyMatch | null {
  const bare = path.split(/[?#]/, 1)[0] ?? ''
  if (!bare.startsWith('/')) return null
  const rest = bare.startsWith(PREFIX) ? bare.slice(PREFIX.length) : bare.slice(1)
  const parts = rest.split('/')
  const upper = method.toUpperCase()
  const found = ROUTES.filter((route) => matches(route, upper, parts))
  if (found.length !== 1 || found[0] === undefined) return null
  const { entry, route } = found[0]
  return { action: entry.action, category: entry.category, key: onlineOnlyKey(entry.action), route }
}

export function onlineOnlyKey(action: OnlineOnlyAction): OnlineOnlyKey {
  return `onlineOnly.${action}`
}
