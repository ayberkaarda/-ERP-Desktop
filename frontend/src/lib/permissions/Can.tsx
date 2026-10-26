import type { ReactNode } from 'react'
import { usePermission, type PermissionRequirement } from './permissions'

interface CanProps {
  permission: PermissionRequirement
  /** 'all' (default) needs every listed permission, 'any' needs one of them. */
  mode?: 'all' | 'any'
  fallback?: ReactNode
  children: ReactNode
}

/** Renders children only when the active company grants the permission. */
export function Can({ permission, mode = 'all', fallback = null, children }: CanProps) {
  return usePermission(permission, mode) ? children : fallback
}
