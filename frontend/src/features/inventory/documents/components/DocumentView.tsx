import { Undo2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { AuditTrail } from '@/components/shared/AuditTrail'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { formatDate, formatDateTime, useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'
import { usePermission } from '@/lib/permissions'
import { useStockWarehouses } from '../../shared/warehouses'
import { dec, lineCost, trimDecimal } from '../lib/quantity'
import { INV_PERMS } from '../permissions'
import type { StockDocument } from '../types'
import { DocStatusBadge } from './DocStatusBadge'
import { DOCS_BASE } from './DocumentEditor'
import { ReverseDialog } from './ReverseDialog'

interface DocumentViewProps {
  document: StockDocument
  onReversed?: (doc: StockDocument) => void
  /** Breadcrumb back to the list the document belongs to. */
  listLabel?: string
  listPath?: string
}

/** Read-only posted or cancelled document: header, lines, reversal, audit. */
export function DocumentView({
  document: doc,
  onReversed,
  listLabel,
  listPath = DOCS_BASE,
}: DocumentViewProps) {
  const { t } = useTranslation('inventoryDocs')
  const locale = useIntlLocale()
  const canReverse = usePermission(INV_PERMS.documents.reverse)
  const [reversing, setReversing] = useState(false)
  const warehouses = useStockWarehouses()
  const qty = (v: string | null | undefined) =>
    v ? formatDecimalDisplay(trimDecimal(v), { locale, minFraction: 0, maxFraction: 6 }) : ''
  const money = (v: string | null | undefined) => (v ? formatDecimalDisplay(v, { locale }) : '—')
  const isCount = doc.doc_type === 'count'
  const hasCost = !isCount && doc.lines.some((l) => l.unit_cost !== null)
  const hasLot = doc.lines.some((l) => l.lot_no)
  const hasSerial = doc.lines.some((l) => l.serial_numbers.length > 0)
  const hasLocation = doc.lines.some((l) => l.location_id)
  const hasTarget = doc.lines.some((l) => l.target_location_id)
  const hasDirection = doc.doc_type === 'adjustment'
  const warehouse = (id: string | null) => {
    const w = warehouses.data?.find((x) => x.id === id)
    return w ? `${w.code} · ${w.name}` : ''
  }

  const facts: [string, ReactNode][] = [
    [t('fields.documentDate'), formatDate(doc.document_date, locale)],
    [
      doc.doc_type === 'transfer' ? t('fields.sourceWarehouse') : t('fields.warehouse'),
      warehouse(doc.warehouse_id),
    ],
  ]
  if (doc.target_warehouse_id)
    facts.push([t('fields.targetWarehouse'), warehouse(doc.target_warehouse_id)])
  if (doc.reason) facts.push([t('fields.reason'), doc.reason])
  if (doc.posted_at) facts.push([t('fields.postedAt'), formatDateTime(doc.posted_at, locale)])
  if (doc.allow_expired) facts.push([t('editor.allowExpired'), t('view.yes')])
  if (doc.journal_entry_id)
    facts.push([
      t('fields.journalEntry'),
      <Link
        key="je"
        to={`/accounting/journal-entries/${doc.journal_entry_id}`}
        className="text-primary hover:underline"
      >
        {t('view.journalEntry')}
      </Link>,
    ])
  if (doc.notes) facts.push([t('fields.notes'), doc.notes])

  const th = 'h-row border-b border-border px-2 text-left font-medium whitespace-nowrap'
  const thr = `${th} text-right`
  const td = 'border-b border-border px-2 py-1.5 align-top'
  const tdr = `${td} text-right tabular-nums`

  return (
    <div className="mx-auto max-w-[1440px] space-y-5 px-6 py-6">
      <PageHeader
        title={`${t(`docType.${doc.doc_type}`)} ${doc.number ?? ''}`.trim()}
        breadcrumbs={[
          { label: t('nav.inventory') },
          { label: listLabel ?? t('list.title'), to: listPath },
          { label: doc.number ?? t('list.unnumbered') },
        ]}
        meta={<DocStatusBadge status={doc.status} />}
        actions={
          doc.status === 'posted' && canReverse ? (
            <Button type="button" variant="secondary" onClick={() => setReversing(true)}>
              <Undo2 aria-hidden="true" />
              {t('reverse.action')}
            </Button>
          ) : undefined
        }
      />
      {doc.status === 'cancelled' && doc.reversal_reason && (
        <p
          role="note"
          className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground"
        >
          {t('view.reversed', {
            date: formatDate(doc.reversal_date ?? doc.reversed_at ?? doc.document_date, locale),
            reason: doc.reversal_reason,
          })}
        </p>
      )}
      <dl className="grid gap-x-6 gap-y-3 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="truncate">{value}</dd>
          </div>
        ))}
      </dl>
      <section
        aria-label={t('view.lines')}
        className="overflow-x-auto rounded-lg border border-border bg-surface"
      >
        <table className="w-full border-separate border-spacing-0 text-table">
          <thead className="bg-surface-sunken text-xs text-muted-foreground">
            <tr>
              <th scope="col" className={`${thr} w-10`}>
                #
              </th>
              <th scope="col" className={th}>
                {t('lines.item')}
              </th>
              {isCount ? (
                <>
                  <th scope="col" className={thr}>
                    {t('count.system')}
                  </th>
                  <th scope="col" className={thr}>
                    {t('count.counted')}
                  </th>
                  <th scope="col" className={thr}>
                    {t('count.variance')}
                  </th>
                </>
              ) : (
                <>
                  {hasDirection && (
                    <th scope="col" className={th}>
                      {t('lines.direction')}
                    </th>
                  )}
                  <th scope="col" className={thr}>
                    {t('lines.quantity')}
                  </th>
                </>
              )}
              <th scope="col" className={th}>
                {t('lines.unit')}
              </th>
              {hasCost && (
                <>
                  <th scope="col" className={thr}>
                    {t('lines.unitCost')}
                  </th>
                  <th scope="col" className={thr}>
                    {t('lines.lineCost')}
                  </th>
                </>
              )}
              {hasLot && (
                <>
                  <th scope="col" className={th}>
                    {t('lines.lot')}
                  </th>
                  <th scope="col" className={th}>
                    {t('lines.expiry')}
                  </th>
                </>
              )}
              {hasSerial && (
                <th scope="col" className={th}>
                  {t('lines.serials')}
                </th>
              )}
              {hasLocation && (
                <th scope="col" className={th}>
                  {t('lines.location')}
                </th>
              )}
              {hasTarget && (
                <th scope="col" className={th}>
                  {t('lines.targetLocation')}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l) => {
              const variance =
                isCount && l.counted_quantity != null
                  ? dec(l.counted_quantity).minus(dec(l.system_quantity)).toString()
                  : null
              return (
                <tr key={l.id}>
                  <td className={`${tdr} text-xs text-muted-foreground`}>{l.line_no}</td>
                  <td className={td}>
                    <span className="font-code">{l.item_code}</span> {l.item_name}
                  </td>
                  {isCount ? (
                    <>
                      <td className={tdr}>{qty(l.system_quantity)}</td>
                      <td className={tdr}>{qty(l.counted_quantity)}</td>
                      <td className={tdr}>{variance ? qty(variance) : ''}</td>
                    </>
                  ) : (
                    <>
                      {hasDirection && (
                        <td className={td}>
                          {l.direction === 'out' ? t('lines.directionOut') : t('lines.directionIn')}
                        </td>
                      )}
                      <td className={tdr}>
                        {qty(l.quantity)}
                        {l.base_quantity &&
                          dec(l.base_quantity).comparedTo(dec(l.quantity)) !== 0 && (
                            <span className="block text-2xs text-muted-foreground">
                              {t('lines.baseQuantity', {
                                quantity: qty(l.base_quantity),
                                unit: l.base_unit_code ?? '',
                              })}
                            </span>
                          )}
                      </td>
                    </>
                  )}
                  <td className={td}>{l.unit_code}</td>
                  {hasCost && (
                    <>
                      <td className={tdr}>{money(l.unit_cost)}</td>
                      <td className={tdr}>
                        {money(l.unit_cost ? lineCost(l.quantity, l.unit_cost)?.toFixed() : null)}
                      </td>
                    </>
                  )}
                  {hasLot && (
                    <>
                      <td className={`${td} font-code`}>{l.lot_no}</td>
                      <td className={td}>
                        {l.expiry_date ? formatDate(l.expiry_date, locale) : ''}
                      </td>
                    </>
                  )}
                  {hasSerial && (
                    <td className={`${td} font-code text-xs`}>{l.serial_numbers.join(', ')}</td>
                  )}
                  {hasLocation && <td className={td}>{l.location_code}</td>}
                  {hasTarget && <td className={td}>{l.target_location_code}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
      {doc.audit && (
        <section aria-label={t('view.audit')} className="space-y-2">
          <h2 className="text-sm font-semibold">{t('view.audit')}</h2>
          <AuditTrail entries={doc.audit} />
        </section>
      )}
      {doc.status === 'posted' && (
        <ReverseDialog
          document={doc}
          open={reversing}
          onOpenChange={setReversing}
          onReversed={(r) => onReversed?.(r)}
        />
      )}
    </div>
  )
}
