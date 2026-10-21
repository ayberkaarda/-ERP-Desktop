import { useAuthStore, type SessionUser } from '@/stores/auth'
import { useCompanyStore } from '@/stores/company'

/**
 * A single permission name, several that must all be granted, or `{ anyOf }`: at least one of
 * them (mirrors policies that accept alternatives, e.g. view or manage).
 */
export type PermissionRequirement =
  string | readonly string[] | { readonly anyOf: readonly string[] }

/** Requirement met by any one of the names. */
export function anyOf(...names: string[]): { readonly anyOf: readonly string[] } {
  return { anyOf: names }
}

export interface PermissionContext {
  user: SessionUser | null
  granted: readonly string[]
  /** True while permissions for a newly selected company are not confirmed yet. */
  stale?: boolean
}

const EMPTY: readonly string[] = []

/** Super admins bypass checks, mirroring Gate::before on the API. */
export function hasPermission(
  ctx: PermissionContext,
  required: PermissionRequirement | undefined,
  mode: 'all' | 'any' = 'all',
): boolean {
  if (!ctx.user) return false
  if (required === undefined) return true
  if (ctx.stale) return false
  if (ctx.user.isSuperAdmin) return true
  if (typeof required === 'object' && 'anyOf' in required) {
    return required.anyOf.length === 0 || required.anyOf.some((n) => ctx.granted.includes(n))
  }
  const names: readonly string[] = typeof required === 'string' ? [required] : required
  if (names.length === 0) return true
  return mode === 'all'
    ? names.every((n) => ctx.granted.includes(n))
    : names.some((n) => ctx.granted.includes(n))
}

/** Permission names granted in the active company. */
export function useGrantedPermissions(): readonly string[] {
  const companyId = useCompanyStore((s) => s.activeCompanyId)
  return useAuthStore((s) => (companyId ? (s.permissions[companyId] ?? EMPTY) : EMPTY))
}

export function usePermissionContext(): PermissionContext {
  const user = useAuthStore((s) => s.user)
  const stale = useAuthStore((s) => s.permissionsState !== 'fresh')
  const granted = useGrantedPermissions()
  return { user, granted, stale }
}

export function usePermission(
  required: PermissionRequirement | undefined,
  mode: 'all' | 'any' = 'all',
): boolean {
  return hasPermission(usePermissionContext(), required, mode)
}

/** Non-reactive check for code outside components (command handlers, loaders). */
export function checkPermission(
  required: PermissionRequirement | undefined,
  mode: 'all' | 'any' = 'all',
): boolean {
  const { user, permissions, permissionsState } = useAuthStore.getState()
  const companyId = useCompanyStore.getState().activeCompanyId
  const granted = companyId ? (permissions[companyId] ?? EMPTY) : EMPTY
  return hasPermission({ user, granted, stale: permissionsState !== 'fresh' }, required, mode)
}
