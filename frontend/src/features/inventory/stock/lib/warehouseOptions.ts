import { usePermission } from '@/lib/permissions'
import { INV_ACCESS } from './permissions'
import type { CodeRef } from './types'

/** Whether the user may list warehouses (GET /warehouses needs warehouse view or manage). */
export function useCanListWarehouses(): boolean {
  return usePermission(INV_ACCESS.warehouses)
}

/** Distinct warehouses referenced by loaded rows, by code (fallback options). */
export function knownWarehouses(refs: readonly (CodeRef | null | undefined)[]): CodeRef[] {
  const map = new Map<string, CodeRef>()
  for (const ref of refs) if (ref && !map.has(ref.id)) map.set(ref.id, ref)
  return [...map.values()].sort((a, b) => a.code.localeCompare(b.code, 'tr', { numeric: true }))
}
