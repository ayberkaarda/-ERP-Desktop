import { PencilLine } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useWarehouses } from '@/features/reference'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'
import { usePermission } from '@/lib/permissions'
import { LoadError, VersionConflictAlert } from '../../shared/components/common'
import { DocumentView, type ViewTab } from '../../shared/components/DocumentView'
import { useComparison, useRfq } from '../../shared/hooks/queries'
import { trimDecimal } from '../../shared/lib/forms'
import { rfqActions } from '../../shared/lib/lifecycle'
import { TABLE } from '../../shared/lib/ui'
import { PURCH_ACCESS, PURCH_PERMS } from '../../shared/permissions'
import type { PurchaseRfq, RfqSupplier } from '../../shared/types'
import { ComparisonMatrix } from '../components/ComparisonMatrix'
import { QuoteEntryDialog } from '../components/QuoteEntryDialog'
import { RfqActions } from '../components/RfqActions'
import { RfqEditor } from '../components/RfqEditor'

const SUPPLIER_TONE = { invited: 'neutral', responded: 'success', declined: 'warning' } as const

function RfqLines({ rfq }: { rfq: PurchaseRfq }) {
  const { t } = useTranslation('purchasing-orders')
  const locale = useIntlLocale()
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
            <th scope="col" className={th}>
              {t('lines.neededBy')}
            </th>
            <th scope="col" className={th}>
              {t('rfqs.awardedTo')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rfq.lines.map((l) => (
            <tr key={l.id}>
              <td className={`${tdr} text-xs text-muted-foreground`}>{l.line_no}</td>
              <td className={td}>
                <span className="font-code">{l.item_code}</span> {l.item_name}
                {l.description && (
                  <span className="block text-xs text-muted-foreground">{l.description}</span>
                )}
              </td>
              <td className={tdr}>
                {formatDecimalDisplay(trimDecimal(l.quantity), {
                  locale,
                  minFraction: 0,
                  maxFraction: 6,
                })}{' '}
                {l.unit_code}
              </td>
              <td className={td}>{l.needed_by ? formatDate(l.needed_by, locale) : '—'}</td>
              <td className={td}>
                {rfq.suppliers.find((s) => s.party_id === l.awarded_party_id)?.party_name ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Suppliers({ rfq, onEnter }: { rfq: PurchaseRfq; onEnter?: (s: RfqSupplier) => void }) {
  const { t } = useTranslation('purchasing-orders')
  const locale = useIntlLocale()
  return (
    <ul
      aria-label={t('rfqs.suppliers')}
      className="divide-y divide-border rounded-lg border border-border bg-surface"
    >
      {rfq.suppliers.map((s) => {
        const quoted = rfq.quotes.filter((q) => q.party_id === s.party_id).length
        return (
          <li key={s.party_id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
            <span className="min-w-48 flex-1 font-medium">{s.party_name}</span>
            <Badge tone={SUPPLIER_TONE[s.status]}>{t(`rfqs.supplierStatus.${s.status}`)}</Badge>
            <span className="text-xs text-muted-foreground">
              {t('rfqs.quotedLines', { quoted, total: rfq.lines.length })}
              {s.responded_at && ` · ${formatDate(s.responded_at.slice(0, 10), locale)}`}
            </span>
            {onEnter && (
              <Button type="button" size="sm" variant="secondary" onClick={() => onEnter(s)}>
                <PencilLine aria-hidden="true" />
                {t('rfqs.quotes.enter', { supplier: s.party_name })}
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function Comparison({ rfq }: { rfq: PurchaseRfq }) {
  const { t } = useTranslation('purchasing-orders')
  const comparison = useComparison(rfq.id, true)
  if (comparison.isPending) return <Skeleton className="h-40 w-full" />
  if (comparison.isError)
    return <LoadError error={comparison.error} onRetry={() => void comparison.refetch()} />
  if (comparison.data.lines.every((l) => l.quotes.length === 0))
    return <p className="text-sm text-muted-foreground">{t('rfqs.comparison.empty')}</p>
  return <ComparisonMatrix comparison={comparison.data} lines={rfq.lines} />
}

/** /purchasing/rfqs/new and /:id: drafts in the editor; sent RFQs collect quotes and are awarded. */
export function RfqPage() {
  const { t } = useTranslation('purchasing-orders')
  const locale = useIntlLocale()
  const { id } = useParams()
  const rfq = useRfq(id)
  const warehouses = useWarehouses()
  const canQuote = usePermission(PURCH_ACCESS.rfqState)
  const [conflict, setConflict] = useState(false)
  const [entering, setEntering] = useState<RfqSupplier | null>(null)
  const data = rfq.data

  const reload = async () => {
    const fresh = (await rfq.refetch()).data
    setConflict(false)
    return fresh
  }

  if (!id) return <RfqEditor document={null} onReload={() => Promise.resolve(undefined)} />
  if (data?.status === 'draft') {
    return (
      <RfqEditor
        key={data.id}
        document={data}
        onReload={reload}
        actions={({ ensureSaved, busy }) => (
          <RfqActions
            rfq={data}
            ensureSaved={ensureSaved}
            busy={busy}
            onConflict={() => void rfq.refetch()}
          />
        )}
      />
    )
  }
  if (data) {
    const warehouse = warehouses.data?.find((w) => w.id === data.warehouse_id)
    const facts: [string, ReactNode][] = [
      [t('fields.documentDate'), formatDate(data.document_date, locale)],
      [t('fields.responseDue'), data.response_due ? formatDate(data.response_due, locale) : '—'],
      [t('fields.currency'), data.currency_code],
      [t('rfqs.suppliers'), String(data.suppliers.length)],
    ]
    if (warehouse) facts.push([t('fields.warehouse'), `${warehouse.code} · ${warehouse.name}`])
    if (data.notes) facts.push([t('fields.notes'), data.notes])
    const quoting = rfqActions(data.status, data.quotes.length).includes('quotes') && canQuote
    const tabs: ViewTab[] = [
      { value: 'lines', label: t('view.lines'), content: <RfqLines rfq={data} /> },
      {
        value: 'suppliers',
        label: t('rfqs.suppliersTab'),
        content: <Suppliers rfq={data} onEnter={quoting ? setEntering : undefined} />,
      },
    ]
    if (data.quotes.length > 0)
      tabs.push({
        value: 'comparison',
        label: t('rfqs.comparison.title'),
        content: <Comparison rfq={data} />,
      })
    return (
      <>
        <DocumentView
          kind="rfq"
          document={data}
          facts={facts}
          tabs={tabs}
          attachPermission={PURCH_PERMS.rfqs.update}
          banner={conflict && <VersionConflictAlert onReload={() => void reload()} />}
          actions={<RfqActions rfq={data} onConflict={() => setConflict(true)} />}
        />
        <QuoteEntryDialog
          rfq={data}
          supplier={entering}
          onClose={() => setEntering(null)}
          onConflict={() => setConflict(true)}
        />
      </>
    )
  }
  if (rfq.isPending) {
    return (
      <div className="mx-auto max-w-[1440px] space-y-4 px-6 py-6" aria-busy="true">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6">
      <LoadError error={rfq.error} onRetry={() => void rfq.refetch()} />
    </div>
  )
}
