import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { Skeleton } from '@/components/ui/skeleton'
import { useWarehouses } from '@/features/reference'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay, formatMoney } from '@/lib/money'
import {
  ApprovalPanel,
  LoadError,
  Notice,
  VersionConflictAlert,
} from '../../shared/components/common'
import { DocumentView, type ViewTab } from '../../shared/components/DocumentView'
import { useRequest } from '../../shared/hooks/queries'
import { trimDecimal } from '../../shared/lib/forms'
import { openOnRequest } from '../../shared/lib/lifecycle'
import { TABLE } from '../../shared/lib/ui'
import { PURCH_PERMS } from '../../shared/permissions'
import type { PurchaseRequest } from '../../shared/types'
import { RequestActions } from '../components/RequestActions'
import { RequestEditor } from '../components/RequestEditor'

function RequestLines({ request }: { request: PurchaseRequest }) {
  const { t } = useTranslation('purchasing-orders')
  const locale = useIntlLocale()
  const money = (v: string) => formatMoney(v, request.currency_code, locale)
  const qty = (v: string) =>
    formatDecimalDisplay(trimDecimal(v), { locale, minFraction: 0, maxFraction: 6 })
  const { th, thr, td, tdr } = TABLE
  return (
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
              {t('lines.ordered')}
            </th>
            <th scope="col" className={thr}>
              {t('wizard.remaining')}
            </th>
            <th scope="col" className={thr}>
              {t('lines.estimatedPrice')}
            </th>
            <th scope="col" className={thr}>
              {t('lines.estimatedTotal')}
            </th>
            <th scope="col" className={th}>
              {t('lines.neededBy')}
            </th>
          </tr>
        </thead>
        <tbody>
          {request.lines.map((l) => (
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
              <td className={tdr}>{qty(l.ordered)}</td>
              <td className={tdr}>{qty(openOnRequest(l).toString())}</td>
              <td className={tdr}>{money(l.estimated_price)}</td>
              <td className={tdr}>{money(l.estimated_total)}</td>
              <td className={td}>{l.needed_by ? formatDate(l.needed_by, locale) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** /purchasing/requests/new and /:id: drafts and rejected requests in the editor, else read-only. */
export function RequestPage() {
  const { t } = useTranslation('purchasing-orders')
  const locale = useIntlLocale()
  const { id } = useParams()
  const request = useRequest(id)
  const warehouses = useWarehouses()
  const [conflict, setConflict] = useState(false)
  const data = request.data

  const reload = async () => {
    const fresh = (await request.refetch()).data
    setConflict(false)
    return fresh
  }

  if (!id) return <RequestEditor document={null} onReload={() => Promise.resolve(undefined)} />
  if (data && (data.status === 'draft' || data.status === 'rejected')) {
    return (
      <div>
        {data.approval_comment && (
          <div className="mx-auto max-w-[1440px] px-6 pt-6">
            <Notice tone="warning">
              {t('approval.rejected', { comment: data.approval_comment })}
            </Notice>
          </div>
        )}
        <RequestEditor
          key={`${data.id}-${data.status}`}
          document={data}
          onReload={reload}
          actions={({ ensureSaved, busy }) => (
            <RequestActions
              request={data}
              ensureSaved={ensureSaved}
              busy={busy}
              onConflict={() => void request.refetch()}
            />
          )}
        />
      </div>
    )
  }
  if (data) {
    const warehouse = warehouses.data?.find((w) => w.id === data.warehouse_id)
    const facts: [string, ReactNode][] = [
      [t('fields.documentDate'), formatDate(data.document_date, locale)],
      [t('fields.neededBy'), data.needed_by ? formatDate(data.needed_by, locale) : '—'],
      [t('fields.estimatedTotal'), formatMoney(data.estimated_total, data.currency_code, locale)],
    ]
    if (warehouse) facts.push([t('fields.warehouse'), `${warehouse.code} · ${warehouse.name}`])
    if (data.notes) facts.push([t('fields.notes'), data.notes])
    if (data.internal_notes) facts.push([t('fields.internalNotes'), data.internal_notes])
    const tabs: ViewTab[] = [
      { value: 'lines', label: t('view.lines'), content: <RequestLines request={data} /> },
    ]
    if (data.approval_request_id)
      tabs.push({
        value: 'approval',
        label: t('approval.tab'),
        content: <ApprovalPanel id={data.approval_request_id} currency={data.currency_code} />,
      })
    return (
      <DocumentView
        kind="request"
        document={data}
        facts={facts}
        tabs={tabs}
        attachPermission={PURCH_PERMS.requests.update}
        banner={
          <>
            {conflict && <VersionConflictAlert onReload={() => void reload()} />}
            {data.status === 'pending_approval' && (
              <Notice tone="info">{t('approval.pending')}</Notice>
            )}
          </>
        }
        actions={<RequestActions request={data} onConflict={() => setConflict(true)} />}
      />
    )
  }
  if (request.isPending) {
    return (
      <div className="mx-auto max-w-[1440px] space-y-4 px-6 py-6" aria-busy="true">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6">
      <LoadError error={request.error} onRetry={() => void request.refetch()} />
    </div>
  )
}
