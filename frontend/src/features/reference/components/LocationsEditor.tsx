import { CornerDownRight, FolderTree, MoveRight, Pencil, Plus, Power } from 'lucide-react'
import { useMemo } from 'react'
import { EmptyState } from '@/components/shared/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { useLocationMutations, useLocations } from '../hooks/useReference'
import { useRefT } from '../i18n'
import { REF_PERMISSIONS } from '../permissions'
import type { WarehouseLocation } from '../types'
import { buildTree } from '../utils'
import { LoadError } from './LoadError'
import { LocationDialog, LocationMoveDialog } from './LocationDialogs'
import { TreeView } from './TreeView'
import { useEditor } from './useEditor'

type Action =
  | { kind: 'create'; parentId: string }
  | { kind: 'edit'; record: WarehouseLocation }
  | { kind: 'move'; record: WarehouseLocation }

/** Tree editor of a warehouse's storage locations: add (also as child), edit, move, deactivate. */
export function LocationsEditor({ warehouseId }: { warehouseId: string }) {
  const t = useRefT()
  const canManage = usePermission(REF_PERMISSIONS.warehouses.manage)
  const locations = useLocations(warehouseId)
  const { update } = useLocationMutations(warehouseId)
  const editor = useEditor<Action>()
  const rows = useMemo(() => locations.data ?? [], [locations.data])
  const tree = useMemo(() => buildTree(rows), [rows])

  const toggleActive = (location: WarehouseLocation) =>
    update.mutate(
      {
        id: location.id,
        version: location.version,
        patch: { is_active: !location.is_active },
      },
      { onError: (error) => platform.notify.error(error.message) },
    )

  return (
    <section aria-labelledby="locations-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="locations-heading" className="text-base font-semibold">
          {t('locations.title')}
        </h2>
        {canManage && (
          <Button onClick={() => editor.openEdit({ kind: 'create', parentId: '' })}>
            <Plus aria-hidden="true" />
            {t('locations.new')}
          </Button>
        )}
      </div>

      {locations.isLoading && <Skeleton className="h-32 w-full" aria-label={t('states.loading')} />}
      {locations.isError && <LoadError onRetry={() => void locations.refetch()} />}
      {locations.data && rows.length === 0 && (
        <EmptyState
          compact
          icon={<FolderTree className="size-10 text-muted-foreground" aria-hidden="true" />}
          title={t('locations.empty')}
          description={t('locations.emptyHint')}
        />
      )}
      {rows.length > 0 && (
        <TreeView<WarehouseLocation>
          nodes={tree}
          label={t('locations.title')}
          renderRow={(loc) => (
            <>
              <Badge tone="neutral">{t(`locations.types.${loc.type}`)}</Badge>
              <span className="font-code text-sm">{loc.code}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{loc.name}</span>
              {loc.barcode && (
                <span className="hidden font-code text-xs text-muted-foreground sm:inline">
                  {loc.barcode}
                </span>
              )}
              {!loc.is_active && <Badge tone="warning">{t('fields.inactive')}</Badge>}
              {canManage && (
                <div className="flex items-center">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('locations.addChild', { name: loc.name })}
                    onClick={() => editor.openEdit({ kind: 'create', parentId: loc.id })}
                  >
                    <CornerDownRight aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('actions.editNamed', { name: loc.name })}
                    onClick={() => editor.openEdit({ kind: 'edit', record: loc })}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('locations.moveNamed', { name: loc.name })}
                    onClick={() => editor.openEdit({ kind: 'move', record: loc })}
                  >
                    <MoveRight aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t(
                      loc.is_active ? 'locations.deactivateNamed' : 'locations.activateNamed',
                      {
                        name: loc.name,
                      },
                    )}
                    disabled={update.isPending}
                    onClick={() => toggleActive(loc)}
                  >
                    <Power aria-hidden="true" />
                  </Button>
                </div>
              )}
            </>
          )}
        />
      )}

      {editor.target.mode === 'edit' && editor.target.record.kind === 'move' && (
        <LocationMoveDialog
          warehouseId={warehouseId}
          all={rows}
          record={editor.target.record.record}
          onClose={editor.close}
        />
      )}
      {editor.target.mode === 'edit' && editor.target.record.kind !== 'move' && (
        <LocationDialog
          warehouseId={warehouseId}
          all={rows}
          record={editor.target.record.kind === 'edit' ? editor.target.record.record : null}
          parentId={
            editor.target.record.kind === 'create' ? editor.target.record.parentId : undefined
          }
          onClose={editor.close}
        />
      )}
    </section>
  )
}
