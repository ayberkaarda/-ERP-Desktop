import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { Skeleton } from '@/components/ui/skeleton'
import { useTaxCodes, useWarehouses } from '@/features/reference'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay, formatMoney } from '@/lib/money'
import {
  ApprovalPanel,
  LoadError,
  Notice,
  VersionConflictAlert,
} from '../../shared/components/common'
import { DocumentView, type ViewTab } from '../../shared/components/DocumentView'
import { SupplierExposureBadge } from '../../shared/components/SupplierPicker'
import { PurchTotals } from '../../shared/components/Totals'
import { useCompanyCurrency, useOrder } from '../../shared/hooks/queries'
import { dec, trimDecimal } from '../../shared/lib/forms'
import { TABLE } from '../../shared/lib/ui'
import { PURCH_PERMS } from '../../shared/permissions'
import type { PurchaseOrder } from '../../shared/types'
import { OrderActions } from '../components/OrderActions'
import { OrderEditor } from '../components/OrderEditor'

function OrderLines({ order }: { order: PurchaseOrder }) {
  const { t } = useTranslation('purchasing-orders')
  const locale = useIntlLocale()
  const taxCodes = useTaxCodes({ includeInactive: true })
  const companyCurrency = useCompanyCurrency()
  const money = (v: string) => formatMoney(v, order.currency_code, locale)
  const qty = (v: string) =>
    formatDecimalDisplay(trimDecimal(v), { locale, minFraction: 0, maxFraction: 6 })
  const code = (id: string | null) => taxCodes.data?.find((c) => c.id === id)?.code ?? ''
  const { th, thr, td, tdr } = TABLE
  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table
          aria-label={t('lines.title')}
          className="w-full border-separate border-spacing-0 text-table"
        >
          <thead className="bg-surface-sunken text-muted-foreground">
            <tr>
              <th scope="col" className={`${thr} w-10`}>
                #
              </th>
              <th scope="col" className={th}>
                {t('lines.item')}
              </th>
              <th scope="col" className={thr}>
                {t('lines.quantity')}
              </th>
              <th scope="col" className={thr}>
                {t('lines.received')}
              </th>
              <th scope="col" className={thr}>
                {t('lines.invoiced')}
              </th>
              <th scope="col" className={thr}>
                {t('lines.unitPrice')}
              </th>
              <th scope="col" className={thr}>
                {t('lines.net')}
              </th>
              <th scope="col" className={thr}>
                {t('lines.tax')}
              </th>
              <th scope="col" className={thr}>
                {t('lines.lineTotal')}
              </th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l) => (
              <tr key={l.id}>
                <td className={`${tdr} text-xs text-muted-foreground`}>{l.line_no}</td>
                <td className={td}>
                  <span className="font-code">{l.item_code}</span> {l.item_name}
                  {l.description && (
                    <span className="block text-xs text-muted-foreground">{l.description}</span>
                  )}
                </td>
                <td className={tdr}>
                  {qty(l.quantity)} {l.unit_code}
                </td>
                <td className={tdr}>{qty(l.received_quantity)}</td>
                <td className={tdr}>{qty(l.invoiced_quantity)}</td>
                <td className={tdr}>{money(l.unit_price)}</td>
                <td className={tdr}>{money(l.net_amount)}</td>
                <td className={tdr}>
                  {money(l.tax_amount)}
                  <span className="block text-2xs text-muted-foreground">
                    {code(l.tax_code_id)} %{trimDecimal(l.tax_rate)}
                    {!dec(l.withholding_amount).isZero() &&
                      ` · ${t('lines.withheld', { amount: money(l.withholding_amount) })}`}
                  </span>
                </td>
                <td className={tdr}>{money(l.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
        <PurchTotals
          className="lg:col-start-2"
          totals={order}
          currency={order.currency_code}
          localCurrency={companyCurrency}
        />
      </div>
    </>
  )
}

function OrderView({
  order,
  banner,
  actions,
}: {
  order: PurchaseOrder
  banner: ReactNode
  actions: ReactNode
}) {
  const { t } = useTranslation('purchasing-orders')
  const locale = useIntlLocale()
  const warehouses = useWarehouses()
  const warehouse = warehouses.data?.find((w) => w.id === order.warehouse_id)
  const facts: [string, ReactNode][] = [
    [
      t('fields.supplier'),
      <div key="s" className="space-y-1">
        {order.party_name}
        <SupplierExposureBadge
          partyId={order.party_id}
          documentTotalLocal={order.total_local}
          counted={order.status !== 'draft' && order.status !== 'pending_approval'}
        />
      </div>,
    ],
    [
      t('fields.taxNumber'),
      [order.party_tax_office, order.party_tax_number].filter(Boolean).join(' / ') || '—',
    ],
    [t('fields.documentDate'), formatDate(order.document_date, locale)],
  ]
  if (order.expected_date)
    facts.push([t('fields.expectedDate'), formatDate(order.expected_date, locale)])
  if (order.due_date) facts.push([t('fields.dueDate'), formatDate(order.due_date, locale)])
  facts.push([
    t('fields.currency'),
    dec(order.fx_rate).eq(1)
      ? order.currency_code
      : `${order.currency_code} · ${trimDecimal(order.fx_rate)}`,
  ])
  if (warehouse) facts.push([t('fields.warehouse'), `${warehouse.code} · ${warehouse.name}`])
  if (order.supplier_reference)
    facts.push([t('fields.supplierReference'), order.supplier_reference])
  if (order.revision > 0) facts.push([t('fields.revision'), String(order.revision)])
  if (order.notes) facts.push([t('fields.notes'), order.notes])
  if (order.internal_notes) facts.push([t('fields.internalNotes'), order.internal_notes])
  const tabs: ViewTab[] = [
    { value: 'lines', label: t('view.lines'), content: <OrderLines order={order} /> },
  ]
  if (order.approval_request_id)
    tabs.push({
      value: 'approval',
      label: t('approval.tab'),
      content: <ApprovalPanel id={order.approval_request_id} currency={order.currency_code} />,
    })
  return (
    <DocumentView
      kind="order"
      document={order}
      facts={facts}
      tabs={tabs}
      banner={banner}
      actions={actions}
      attachPermission={PURCH_PERMS.orders.update}
    />
  )
}

/** /purchasing/orders/new and /:id: drafts and revisions in the editor, else read-only. */
export function OrderPage() {
  const { t } = useTranslation('purchasing-orders')
  const { id } = useParams()
  const order = useOrder(id)
  const [conflict, setConflict] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [revising, setRevising] = useState<string | null>(null)
  const data = order.data
  if (data?.status === 'draft' && editing !== data.id) setEditing(data.id)
  const inEditor = data !== undefined && (data.status === 'draft' || editing === data.id)

  const reload = async () => {
    const fresh = (await order.refetch()).data
    if (fresh && fresh.status !== 'draft') setEditing(null)
    setConflict(false)
    return fresh
  }

  if (!id) return <OrderEditor document={null} onReload={() => Promise.resolve(undefined)} />
  if (data?.id !== undefined && revising === data.id) {
    return (
      <OrderEditor
        key={`revise-${data.id}`}
        mode="revise"
        document={data}
        onReload={reload}
        onRevised={() => setRevising(null)}
        onCancelRevise={() => setRevising(null)}
      />
    )
  }
  if (data && inEditor) {
    return (
      <div>
        {data.approval_comment && (
          <div className="mx-auto max-w-[1440px] px-6 pt-6">
            <Notice tone="warning">
              {t('approval.rejected', { comment: data.approval_comment })}
            </Notice>
          </div>
        )}
        <OrderEditor
          key={data.id}
          document={data}
          onReload={reload}
          actions={({ ensureSaved, busy }) => (
            <OrderActions
              order={data}
              ensureSaved={ensureSaved}
              busy={busy}
              onConflict={() => void order.refetch()}
              onDone={() => setEditing(null)}
            />
          )}
        />
      </div>
    )
  }
  if (data) {
    return (
      <OrderView
        order={data}
        banner={
          <>
            {conflict && <VersionConflictAlert onReload={() => void reload()} />}
            {data.status === 'pending_approval' && (
              <Notice tone="info">{t('approval.pending')}</Notice>
            )}
          </>
        }
        actions={
          <OrderActions
            order={data}
            onConflict={() => setConflict(true)}
            onRevise={() => setRevising(data.id)}
          />
        }
      />
    )
  }
  if (order.isPending) {
    return (
      <div className="mx-auto max-w-[1440px] space-y-4 px-6 py-6" aria-busy="true">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6">
      <LoadError error={order.error} onRetry={() => void order.refetch()} />
    </div>
  )
}
