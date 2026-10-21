import { RequireAuth } from '@/app/guards'
import { usePermission } from '@/lib/permissions'
import type { CatalogAccess } from '../permissions'

/** Route guard that opens with the read or the manage permission (the API lets both read). */
export function RequireReadOrManage({ access }: { access: CatalogAccess }) {
  const canManage = usePermission(access.manage)
  return <RequireAuth permission={canManage ? access.manage : access.read} />
}
