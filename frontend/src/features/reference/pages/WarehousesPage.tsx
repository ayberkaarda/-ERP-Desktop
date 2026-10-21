import { createColumnHelper } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { DataTable, useUrlListQuery } from '@/components/shared/data-table'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Can, usePermission } from '@/lib/permissions'
import { PageShell } from '../components/PageShell'
import { RowActions } from '../components/RowActions'
import { useEditor } from '../components/useEditor'
import { WarehouseDialog } from '../components/WarehouseDialog'
import { useRemoveWarehouse, useWarehouseList } from '../hooks/useReference'
import { useRefT } from '../i18n'
import { REF_PERMISSIONS } from '../permissions'
import { NEGATIVE_STOCK_POLICIES, type Warehouse } from '../types'

const col = createColumnHelper<Warehouse>()

export function WarehousesPage() {
  const t = useRefT()
  const navigate = useNavigate()
  const canManage = usePermission(REF_PERMISSIONS.warehouses.manage)
  const editor = useEditor<Warehouse>()
  const remove = useRemoveWarehouse()
  const { query, setQuery } = useUrlListQuery(
    { sort: [{ id: 'code', desc: false }] },
    { viewKey: 'reference.warehouses' },
  )
  const list = useWarehouseList(query)

  const columns = useMemo(
    () => [
      col.accessor('code', {
        header: t('fields.code'),
        enableSorting: true,
        meta: { label: t('fields.code') },
        cell: (c) => (
          <span className="flex items-center gap-2">
            <span className="font-code">{c.getValue()}</span>
            {c.row.original.is_default && <Badge tone="primary">{t('warehouses.default')}</Badge>}
          </span>
        ),
        size: 160,
      }),
      col.accessor('name', {
        header: t('fields.name'),
        enableSorting: true,
        meta: { label: t('fields.name') },
        size: 260,
      }),
      col.accessor('negative_stock_policy', {
        header: t('warehouses.negativeStock'),
        meta: {
          label: t('warehouses.negativeStock'),
          filter: {
            key: 'negative_stock_policy',
            options: NEGATIVE_STOCK_POLICIES.map((p) => ({
              value: p,
              label: t(`warehouses.policies.${p}`),
            })),
          },
        },
        cell: (c) => t(`warehouses.policies.${c.getValue()}`),
        size: 160,
      }),
      col.accessor('is_active', {
        header: t('fields.status'),
        meta: {
          label: t('fields.status'),
          filter: {
            key: 'is_active',
            options: [
              { value: '1', label: t('fields.active') },
              { value: '0', label: t('fields.inactive') },
            ],
          },
        },
        cell: (c) => <StatusBadge status={c.getValue() ? 'active' : 'inactive'} />,
        size: 110,
      }),
      col.display({
        id: 'actions',
        header: () => <span className="sr-only">{t('fields.actions')}</span>,
        meta: { label: t('fields.actions'), align: 'right' },
        enableHiding: false,
        cell: (c) => (
          <RowActions
            name={c.row.original.code}
            onEdit={canManage ? () => editor.openEdit(c.row.original) : undefined}
            onDelete={canManage ? () => remove.mutateAsync(c.row.original.id) : undefined}
            extra={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void navigate(`/reference/warehouses/${c.row.original.id}`)}
              >
                {t('warehouses.locations')}
              </Button>
            }
          />
        ),
        size: 180,
      }),
    ],
    // editor, remove and navigate are stable for the lifetime of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, canManage],
  )

  return (
    <PageShell
      title={t('warehouses.title')}
      description={t('warehouses.subtitle')}
      actions={
        <Can permission={REF_PERMISSIONS.warehouses.manage}>
          <Button onClick={editor.openNew}>
            <Plus aria-hidden="true" />
            {t('warehouses.new')}
          </Button>
        </Can>
      }
    >
      <DataTable<Warehouse>
        label={t('warehouses.title')}
        columns={columns}
        data={list.data?.data ?? []}
        total={list.data?.meta?.total ?? list.data?.data.length ?? 0}
        loading={list.isLoading}
        error={list.isError}
        onRetry={() => void list.refetch()}
        query={query}
        onQueryChange={setQuery}
        getRowId={(r) => r.id}
        viewKey="reference.warehouses"
        onRowActivate={(row) => void navigate(`/reference/warehouses/${row.id}`)}
      />
      {editor.target.mode !== 'closed' && (
        <WarehouseDialog
          record={editor.target.mode === 'edit' ? editor.target.record : null}
          onClose={editor.close}
        />
      )}
    </PageShell>
  )
}
