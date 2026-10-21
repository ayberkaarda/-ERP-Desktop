import { CornerDownRight, FolderTree, Pencil, Plus, Power } from 'lucide-react'
import { useMemo } from 'react'
import { EmptyState } from '@/components/shared/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Can, usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { CostCenterDialog } from '../components/CostCenterDialog'
import { LoadError } from '../components/LoadError'
import { PageShell } from '../components/PageShell'
import { TreeView } from '../components/TreeView'
import { useEditor } from '../components/useEditor'
import { useCostCenters, useUpdateCostCenter } from '../hooks/useReference'
import { useRefT } from '../i18n'
import { REF_PERMISSIONS } from '../permissions'
import type { CostCenter } from '../types'
import { buildTree } from '../utils'

interface Action {
  record: CostCenter | null
  parentId: string
}

export function CostCentersPage() {
  const t = useRefT()
  const canManage = usePermission(REF_PERMISSIONS.costCenters.manage)
  const centers = useCostCenters()
  const update = useUpdateCostCenter()
  const editor = useEditor<Action>()
  const rows = useMemo(() => centers.data ?? [], [centers.data])
  const tree = useMemo(() => buildTree(rows), [rows])

  const toggleActive = (center: CostCenter) =>
    update.mutate(
      { id: center.id, version: center.version, patch: { is_active: !center.is_active } },
      { onError: (error) => platform.notify.error(error.message) },
    )

  return (
    <PageShell
      title={t('costCenters.title')}
      description={t('costCenters.subtitle')}
      actions={
        <Can permission={REF_PERMISSIONS.costCenters.manage}>
          <Button onClick={() => editor.openEdit({ record: null, parentId: '' })}>
            <Plus aria-hidden="true" />
            {t('costCenters.new')}
          </Button>
        </Can>
      }
    >
      {centers.isLoading && <Skeleton className="h-40 w-full" aria-label={t('states.loading')} />}
      {centers.isError && (
        <LoadError error={centers.error} onRetry={() => void centers.refetch()} />
      )}
      {centers.data && rows.length === 0 && (
        <EmptyState
          compact
          icon={<FolderTree className="size-10 text-muted-foreground" aria-hidden="true" />}
          title={t('costCenters.empty')}
        />
      )}
      {rows.length > 0 && (
        <TreeView<CostCenter>
          nodes={tree}
          label={t('costCenters.title')}
          renderRow={(c) => (
            <>
              <span className="font-code text-sm">{c.code}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
              {!c.is_active && <Badge tone="warning">{t('fields.inactive')}</Badge>}
              {canManage && (
                <div className="flex items-center">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('costCenters.addChild', { name: c.name })}
                    onClick={() => editor.openEdit({ record: null, parentId: c.id })}
                  >
                    <CornerDownRight aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('actions.editNamed', { name: c.name })}
                    onClick={() => editor.openEdit({ record: c, parentId: '' })}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t(
                      c.is_active ? 'costCenters.deactivateNamed' : 'costCenters.activateNamed',
                      {
                        name: c.name,
                      },
                    )}
                    disabled={update.isPending}
                    onClick={() => toggleActive(c)}
                  >
                    <Power aria-hidden="true" />
                  </Button>
                </div>
              )}
            </>
          )}
        />
      )}
      {editor.target.mode === 'edit' && (
        <CostCenterDialog
          record={editor.target.record.record}
          parentId={editor.target.record.parentId}
          onClose={editor.close}
        />
      )}
    </PageShell>
  )
}
