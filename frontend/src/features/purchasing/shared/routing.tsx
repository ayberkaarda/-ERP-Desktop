import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'
import type { PermissionRequirement } from '@/lib/permissions'

/** A route group behind the auth guard with a permission. */
export function guarded(permission: PermissionRequirement, children: RouteObject[]): RouteObject {
  return { element: <RequireAuth permission={permission} />, children }
}
