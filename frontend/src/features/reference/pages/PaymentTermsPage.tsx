import { createColumnHelper } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useMemo } from 'react'
import { DataTable, useUrlListQuery } from '@/components/shared/data-table'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { formatDecimal } from '@/lib/money'
import { Can, usePermission } from '@/lib/permissions'
import { PageShell } from '../components/PageShell'
import { PaymentTermDialog } from '../components/PaymentTermDialog'
import { RowActions } from '../components/RowActions'
import { useEditor } from '../components/useEditor'
import { usePaymentTermList, useRemovePaymentTerm } from '../hooks/useReference'
import { useRefT } from '../i18n'
import { REF_PERMISSIONS } from '../permissions'
import type { PaymentTerm } from '../types'
import { useIntlLocale } from '@/lib/datetime/locale'

const col = createColumnHelper<PaymentTerm>()

export function PaymentTermsPage() {
  const t = useRefT()
  const locale = useIntlLocale()
  const canUpdate = usePermission(REF_PERMISSIONS.paymentTerms.update)
  const canDelete = usePermission(REF_PERMISSIONS.paymentTerms.delete)
  const editor = useEditor<PaymentTerm>()
  const remove = useRemovePaymentTerm()
  const { query, setQuery } = useUrlListQuery(
    { sort: [{ id: 'code', desc: false }] },
    { viewKey: 'reference.payment-terms' },
  )
  const list = usePaymentTermList(query)

  const columns = useMemo(
    () => [
      col.accessor('code', {
        header: t('fields.code'),
        enableSorting: true,
        meta: { label: t('fields.code') },
        cell: (c) => <span className="font-code">{c.getValue()}</span>,
        size: 120,
      }),
      col.accessor('name', {
        header: t('fields.name'),
        enableSorting: true,
        meta: { label: t('fields.name') },
        size: 240,
      }),
      // Not sortable: the backend sorts payment terms by code, name and created_at only.
      col.accessor('due_days', {
        header: t('paymentTerms.dueDays'),
        meta: { label: t('paymentTerms.dueDays'), align: 'right' },
        size: 110,
      }),
      col.accessor('discount_percent', {
        header: t('paymentTerms.discountPercent'),
        meta: { label: t('paymentTerms.discountPercent'), align: 'right' },
        cell: (c) => {
          const v = c.getValue()
          return v === null || Number(v) === 0 ? '—' : `${formatDecimal(v, 2, locale)} %`
        },
        size: 130,
      }),
      col.accessor('discount_days', {
        header: t('paymentTerms.discountDays'),
        meta: { label: t('paymentTerms.discountDays'), align: 'right' },
        cell: (c) => c.getValue() ?? '—',
        size: 120,
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
      ...(canUpdate || canDelete
        ? [
            col.display({
              id: 'actions',
              header: () => <span className="sr-only">{t('fields.actions')}</span>,
              meta: { label: t('fields.actions'), align: 'right' as const },
              enableHiding: false,
              cell: (c) => (
                <RowActions
                  name={c.row.original.code}
                  onEdit={canUpdate ? () => editor.openEdit(c.row.original) : undefined}
                  onDelete={
                    canDelete
                      ? () =>
                          remove.mutateAsync({
                            id: c.row.original.id,
                            version: c.row.original.version,
                          })
                      : undefined
                  }
                />
              ),
              size: 100,
            }),
          ]
        : []),
    ],
    // editor and remove are stable for the lifetime of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, locale, canUpdate, canDelete],
  )

  return (
    <PageShell
      title={t('paymentTerms.title')}
      description={t('paymentTerms.subtitle')}
      actions={
        <Can permission={REF_PERMISSIONS.paymentTerms.create}>
          <Button onClick={editor.openNew}>
            <Plus aria-hidden="true" />
            {t('paymentTerms.new')}
          </Button>
        </Can>
      }
    >
      <DataTable<PaymentTerm>
        label={t('paymentTerms.title')}
        columns={columns}
        data={list.data?.data ?? []}
        total={list.data?.meta?.pagination?.total ?? list.data?.data.length ?? 0}
        loading={list.isLoading}
        error={list.isError}
        onRetry={() => void list.refetch()}
        query={query}
        onQueryChange={setQuery}
        getRowId={(r) => r.id}
        viewKey="reference.payment-terms"
        onRowActivate={canUpdate ? editor.openEdit : undefined}
      />
      {editor.target.mode !== 'closed' && (
        <PaymentTermDialog
          record={editor.target.mode === 'edit' ? editor.target.record : null}
          onClose={editor.close}
        />
      )}
    </PageShell>
  )
}
