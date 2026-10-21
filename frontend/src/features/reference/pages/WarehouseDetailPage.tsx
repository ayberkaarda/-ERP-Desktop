import { Pencil } from 'lucide-react'
import { useParams } from 'react-router'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { usePermission } from '@/lib/permissions'
import { useEditor } from '../components/useEditor'
import { LoadError } from '../components/LoadError'
import { LocationsEditor } from '../components/LocationsEditor'
import { PageShell } from '../components/PageShell'
import { WarehouseDialog } from '../components/WarehouseDialog'
import { useWarehouse } from '../hooks/useReference'
import { useRefT } from '../i18n'
import { REF_PERMISSIONS } from '../permissions'
import type { Warehouse } from '../types'

function formatAddress(w: Warehouse): string {
  const a = w.address
  if (!a) return ''
  return [a.line1, a.line2, a.district, a.postal_code, a.city, a.country]
    .filter((part) => part && part.trim() !== '')
    .join(', ')
}

export function WarehouseDetailPage() {
  const t = useRefT()
  const { id = '' } = useParams()
  const canManage = usePermission(REF_PERMISSIONS.warehouses.manage)
  const warehouse = useWarehouse(id)
  const editor = useEditor<Warehouse>()
  const w = warehouse.data

  return (
    <PageShell
      title={w ? `${w.code} · ${w.name}` : t('warehouses.title')}
      breadcrumbs={[
        { label: t('warehouses.title'), to: '/reference/warehouses' },
        { label: w?.code ?? '…' },
      ]}
      meta={w ? <StatusBadge status={w.is_active ? 'active' : 'inactive'} /> : undefined}
      actions={
        canManage && w ? (
          <Button variant="secondary" onClick={() => editor.openEdit(w)}>
            <Pencil aria-hidden="true" />
            {t('warehouses.edit')}
          </Button>
        ) : undefined
      }
    >
      {warehouse.isLoading && <Skeleton className="h-24 w-full" aria-label={t('states.loading')} />}
      {warehouse.isError && <LoadError onRetry={() => void warehouse.refetch()} />}
      {w && (
        <div className="space-y-6">
          <Card>
            <CardContent className="grid gap-3 pt-4 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">{t('warehouses.negativeStock')}</p>
                <p>{t(`warehouses.policies.${w.negative_stock_policy}`)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('warehouses.default')}</p>
                <p>
                  {w.is_default ? <Badge tone="primary">{t('warehouses.default')}</Badge> : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('warehouses.address.title')}</p>
                <p>{formatAddress(w) || '—'}</p>
              </div>
            </CardContent>
          </Card>
          <LocationsEditor warehouseId={w.id} />
        </div>
      )}
      {editor.target.mode === 'edit' && (
        <WarehouseDialog record={editor.target.record} onClose={editor.close} />
      )}
    </PageShell>
  )
}
