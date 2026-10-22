import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AttachmentPanel, createFilesApi } from '@/components/shared/attachments'
import { AuditTrail } from '@/components/shared/AuditTrail'
import { PageHeader } from '@/components/shared/PageHeader'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTaxCodes, useWarehouses } from '@/features/reference'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay, formatMoney } from '@/lib/money'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import type { SalesOrder, SalesQuote } from '../api'
import { useCompanyCurrency } from '../hooks/queries'
import { dec, trimDecimal } from '../lib/lines'
import { SALES_PATHS } from '../lib/insights'
import { SALES_PERMS } from '../permissions'
import type { SalesKind, SalesLine, SalesOrderLine } from '../types'
import { SalesStatusBadge } from './common'
import { DocumentChain } from './DocumentChain'
import { TotalsPanel, WarningsList } from './TotalsPanel'

export interface ExtraTab {
  value: string
  label: string
  content: ReactNode
}

interface SalesDocumentViewProps {
  kind: SalesKind
  document: SalesQuote | SalesOrder
  actions?: ReactNode
  /** Notices above the facts (approval state, cancellation reason). */
  banner?: ReactNode
  extraTabs?: ExtraTab[]
}

const isOrderLine = (l: SalesLine): l is SalesOrderLine => 'delivered_quantity' in l

/** Read-only quote or order: facts, chain, lines, totals, audit and attachments. */
export function SalesDocumentView({
  kind,
  document: doc,
  actions,
  banner,
  extraTabs = [],
}: SalesDocumentViewProps) {
  const { t } = useTranslation('sales-shared')
  const locale = useIntlLocale()
  const canAttach = usePermission(
    kind === 'quote' ? SALES_PERMS.quotes.update : SALES_PERMS.orders.update,
  )
  const warehouses = useWarehouses()
  const taxCodes = useTaxCodes({ includeInactive: true })
  const companyCurrency = useCompanyCurrency()
  const taxCodeOf = (l: SalesLine) =>
    l.tax_code ?? taxCodes.data?.find((c) => c.id === l.tax_code_id)?.code ?? ''
  const files = useMemo(
    () =>
      createFilesApi(platform.http, {
        type: kind === 'quote' ? 'sales_quote' : 'sales_order',
        id: doc.id,
      }),
    [kind, doc.id],
  )
  const money = (v: string) => formatMoney(v, doc.currency_code, locale)
  const qty = (v: string) =>
    formatDecimalDisplay(trimDecimal(v), { locale, minFraction: 0, maxFraction: 6 })
  const orderLines = doc.lines.filter(isOrderLine)
  const showProgress = kind === 'order' && orderLines.length === doc.lines.length
  const warehouse = warehouses.data?.find((w) => w.id === doc.warehouse_id)

  const facts: [string, ReactNode][] = [
    [t('fields.party'), doc.party.name],
    [
      t('fields.taxNumber'),
      [doc.party.tax_office, doc.party.tax_number].filter(Boolean).join(' / ') || '—',
    ],
    [t('fields.documentDate'), formatDate(doc.document_date, locale)],
  ]
  if ('valid_until' in doc && doc.valid_until)
    facts.push([t('fields.validUntil'), formatDate(doc.valid_until, locale)])
  if ('requested_delivery_date' in doc && doc.requested_delivery_date)
    facts.push([t('fields.requestedDeliveryDate'), formatDate(doc.requested_delivery_date, locale)])
  if (doc.due_date) facts.push([t('fields.dueDate'), formatDate(doc.due_date, locale)])
  facts.push([
    t('fields.currency'),
    dec(doc.fx_rate).eq(1)
      ? doc.currency_code
      : `${doc.currency_code} · ${trimDecimal(doc.fx_rate)}`,
  ])
  if (warehouse) facts.push([t('fields.warehouse'), `${warehouse.code} · ${warehouse.name}`])
  if ('revision' in doc && (doc.revision ?? 0) > 0)
    facts.push([t('fields.revision'), String(doc.revision)])
  if (doc.notes) facts.push([t('fields.notes'), doc.notes])
  if (doc.internal_notes) facts.push([t('fields.internalNotes'), doc.internal_notes])

  const th = 'h-row border-b border-border px-2 text-left font-medium whitespace-nowrap'
  const thr = `${th} text-right`
  const td = 'border-b border-border px-2 py-1.5 align-top'
  const tdr = `${td} text-right tabular-nums`
  const listPath = SALES_PATHS[kind]
  const title = `${t(`kind.${kind}`)} ${doc.number ?? t('editor.unnumbered')}`

  return (
    <div className="mx-auto max-w-[1440px] space-y-5 px-6 py-6">
      <PageHeader
        title={title}
        breadcrumbs={[
          { label: t('nav.sales') },
          { label: t(`nav.${kind}s`), to: listPath },
          { label: doc.number ?? t('editor.unnumbered') },
        ]}
        meta={<SalesStatusBadge kind={kind} status={doc.status} />}
        actions={actions}
      />
      {banner}
      <dl className="grid gap-x-6 gap-y-3 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>
      <section aria-label={t('chain.title')} className="space-y-2">
        <h2 className="text-sm font-semibold">{t('chain.title')}</h2>
        <DocumentChain
          current={{
            type: kind === 'quote' ? 'sales_quote' : 'sales_order',
            id: doc.id,
            number: doc.number,
            status: doc.status,
            document_date: doc.document_date,
            total: doc.total,
            currency_code: doc.currency_code,
          }}
          links={doc.links}
        />
      </section>
      <Tabs defaultValue="lines">
        <TabsList>
          <TabsTrigger value="lines">{t('view.lines')}</TabsTrigger>
          {extraTabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
          <TabsTrigger value="audit">{t('view.audit')}</TabsTrigger>
          <TabsTrigger value="attachments">{t('view.attachments')}</TabsTrigger>
        </TabsList>
        <TabsContent value="lines" className="space-y-4">
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table
              aria-label={t('view.lines')}
              className="w-full border-separate border-spacing-0 text-table"
            >
              <thead className="bg-surface-sunken text-xs text-muted-foreground">
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
                  {showProgress && (
                    <>
                      <th scope="col" className={thr}>
                        {t('lines.delivered')}
                      </th>
                      <th scope="col" className={thr}>
                        {t('lines.invoiced')}
                      </th>
                    </>
                  )}
                  <th scope="col" className={thr}>
                    {t('lines.unitPrice')}
                  </th>
                  <th scope="col" className={thr}>
                    {t('lines.discount')}
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
                {doc.lines.map((l) => (
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
                    {showProgress && isOrderLine(l) && (
                      <>
                        <td className={tdr}>{qty(l.delivered_quantity)}</td>
                        <td className={tdr}>{qty(l.invoiced_quantity)}</td>
                      </>
                    )}
                    <td className={tdr}>{money(l.unit_price)}</td>
                    <td className={tdr}>
                      {[
                        dec(l.discount_percent).isZero()
                          ? null
                          : `%${trimDecimal(l.discount_percent)}`,
                        dec(l.discount_amount).isZero() ? null : money(l.discount_amount),
                      ]
                        .filter(Boolean)
                        .join(' + ') || '—'}
                    </td>
                    <td className={tdr}>{money(l.net_amount)}</td>
                    <td className={tdr}>
                      {money(l.tax_amount)}
                      <span className="block text-2xs text-muted-foreground">
                        {taxCodeOf(l)} %{trimDecimal(l.tax_rate)}
                      </span>
                    </td>
                    <td className={tdr}>{money(l.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
            <WarningsList
              warnings={doc.warnings ?? []}
              lineLabel={(w) => (w.line_no ? t('warnings.line', { index: w.line_no }) : null)}
            />
            <TotalsPanel
              className="lg:col-start-2"
              totals={doc}
              currency={doc.currency_code}
              localCurrency={doc.local_currency_code ?? companyCurrency}
            />
          </div>
        </TabsContent>
        {extraTabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            {tab.content}
          </TabsContent>
        ))}
        <TabsContent value="audit">
          <AuditTrail entries={doc.audit ?? []} />
        </TabsContent>
        <TabsContent value="attachments">
          <AttachmentPanel api={files} readOnly={!canAttach} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
