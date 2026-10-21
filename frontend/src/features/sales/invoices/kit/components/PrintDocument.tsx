import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Printer } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { useCompanyStore } from '@/stores/company'
import { http, seg } from '../http'
import { salesDocsKeys, type DocBranch } from '../keys'
import { LINK_PATHS } from '../links'
import { money, percent, qty } from '../money'
import type { Envelope, PrintModel, PrintParty } from '../types'
import { LoadError } from './LoadError'

const RESOURCE: Record<DocBranch, string> = {
  deliveries: '/sales-deliveries',
  invoices: '/sales-invoices',
  returns: '/sales-returns',
}

const BACK: Record<DocBranch, string> = {
  deliveries: LINK_PATHS.sales_delivery,
  invoices: LINK_PATHS.sales_invoice,
  returns: LINK_PATHS.sales_return,
}

// Only the sheet is printed: the app shell, header and buttons are hidden on paper.
const PRINT_CSS = `@media print {
  @page { size: A4; margin: 12mm; }
  body * { visibility: hidden !important; }
  .sales-print-sheet, .sales-print-sheet * { visibility: visible !important; }
  .sales-print-sheet { position: absolute; inset: 0 auto auto 0; width: 100%; box-shadow: none !important; border: 0 !important; }
}`

/** /sales/<resource>/:id/print — the print model laid out as an A4 sheet; Ctrl+P or the button. */
export function PrintDocumentPage({ branch }: { branch: DocBranch }) {
  const { id = '' } = useParams()
  const { t } = useTranslation('sales-docs')
  useCompanyStore((s) => s.activeCompanyId)
  const model = useQuery({
    queryKey: salesDocsKeys.print(branch, id),
    queryFn: ({ signal }) =>
      http()
        .get<Envelope<PrintModel>>(`${RESOURCE[branch]}/${seg(id)}/print-model`, { signal })
        .then((r) => r.data),
    enabled: id !== '',
  })

  return (
    <div className="mx-auto max-w-[900px] px-6 py-6">
      <style>{PRINT_CSS}</style>
      <div className="mb-4 flex items-center justify-between gap-2 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link to={`${BACK[branch]}/${encodeURIComponent(id)}`}>
            <ArrowLeft aria-hidden="true" />
            {t('print.back')}
          </Link>
        </Button>
        <Button type="button" disabled={!model.data} onClick={() => window.print()}>
          <Printer aria-hidden="true" />
          {t('print.print')}
        </Button>
      </div>
      {model.data ? (
        <PrintSheet model={model.data} />
      ) : model.isError ? (
        <LoadError error={model.error} onRetry={() => void model.refetch()} />
      ) : (
        <Skeleton className="h-[60rem] w-full" />
      )}
    </div>
  )
}

function PartyBlock({ title, party }: { title: string; party: PrintParty }) {
  const { t } = useTranslation('sales-docs')
  return (
    <div className="space-y-0.5 text-sm">
      <p className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </p>
      <p className="font-semibold">{party.name}</p>
      {party.address && <p className="whitespace-pre-line">{party.address}</p>}
      {(party.tax_office ?? party.tax_number) && (
        <p>
          {t('print.taxInfo', { office: party.tax_office ?? '', number: party.tax_number ?? '' })}
        </p>
      )}
      {party.phone && <p>{party.phone}</p>}
      {party.email && <p>{party.email}</p>}
    </div>
  )
}

/** The sheet itself: parties, references, lines, tax summary and totals. */
export function PrintSheet({ model }: { model: PrintModel }) {
  const { t } = useTranslation('sales-docs')
  const locale = useIntlLocale()
  const priced = model.document_type !== 'sales_delivery'
  const cur = model.currency_code ?? undefined
  const hasLot = model.lines.some(
    (l) => (l.lot_no ?? '') !== '' || (l.serial_numbers?.length ?? 0) > 0,
  )
  const hasDiscount = model.lines.some((l) => l.discount_percent && l.discount_percent !== '0')
  const th = 'border-b border-foreground/40 px-1.5 py-1 text-left font-semibold'
  const thr = `${th} text-right`
  const td = 'border-b border-border px-1.5 py-1 align-top'
  const tdr = `${td} text-right tabular-nums`

  return (
    <article
      className="sales-print-sheet space-y-5 rounded-lg border border-border bg-white p-8 text-[12px] text-black shadow-sm"
      aria-label={model.title}
      data-testid="print-sheet"
    >
      <header className="flex items-start justify-between gap-6">
        <PartyBlock title={t('print.seller')} party={model.company} />
        <div className="text-right">
          <h1 className="text-xl font-semibold">{model.title}</h1>
          <dl className="mt-2 grid grid-cols-[auto_auto] justify-end gap-x-3 gap-y-0.5">
            <dt className="text-muted-foreground">{t('fields.number')}</dt>
            <dd className="font-code">{model.number ?? t('print.draft')}</dd>
            <dt className="text-muted-foreground">{t('fields.documentDate')}</dt>
            <dd>{formatDate(model.document_date, locale)}</dd>
            {model.due_date && (
              <>
                <dt className="text-muted-foreground">{t('fields.dueDate')}</dt>
                <dd>{formatDate(model.due_date, locale)}</dd>
              </>
            )}
            {model.currency_code && model.fx_rate && model.fx_rate !== '1' && (
              <>
                <dt className="text-muted-foreground">{t('fields.fxRate')}</dt>
                <dd className="tabular-nums">
                  {model.currency_code} {qty(model.fx_rate, locale)}
                </dd>
              </>
            )}
            {model.references?.map((r) => (
              <div key={r.label} className="contents">
                <dt className="text-muted-foreground">{r.label}</dt>
                <dd className="font-code">{r.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </header>
      <div className="grid grid-cols-2 gap-6">
        <PartyBlock title={t('print.buyer')} party={model.party} />
        {model.delivery_address && (
          <div className="text-sm">
            <p className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t('print.deliveryAddress')}
            </p>
            <p className="whitespace-pre-line">{model.delivery_address}</p>
          </div>
        )}
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={th}>#</th>
            <th className={th}>{t('fields.item')}</th>
            <th className={thr}>{t('fields.quantity')}</th>
            {hasLot && <th className={th}>{t('fields.lotSerial')}</th>}
            {priced && <th className={thr}>{t('fields.unitPrice')}</th>}
            {priced && hasDiscount && <th className={thr}>{t('fields.discountPercent')}</th>}
            {priced && <th className={thr}>{t('fields.taxRate')}</th>}
            {priced && <th className={thr}>{t('fields.netAmount')}</th>}
          </tr>
        </thead>
        <tbody>
          {model.lines.map((l) => (
            <tr key={l.line_no}>
              <td className={td}>{l.line_no}</td>
              <td className={td}>
                {l.item_code && <span className="font-code">{l.item_code} </span>}
                {l.description}
              </td>
              <td className={tdr}>
                {qty(l.quantity, locale)} {l.unit_code ?? ''}
              </td>
              {hasLot && (
                <td className={td}>
                  {[l.lot_no, ...(l.serial_numbers ?? [])].filter(Boolean).join(', ')}
                </td>
              )}
              {priced && <td className={tdr}>{money(l.unit_price, locale)}</td>}
              {priced && hasDiscount && (
                <td className={tdr}>{percent(l.discount_percent, locale)}</td>
              )}
              {priced && <td className={tdr}>{percent(l.tax_rate, locale)}</td>}
              {priced && <td className={tdr}>{money(l.net_amount, locale)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {priced && model.totals && (
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0 flex-1 space-y-2">
            {model.tax_summary && model.tax_summary.length > 0 && (
              <table className="border-collapse text-[11px]">
                <thead>
                  <tr>
                    <th className={th}>{t('fields.taxCode')}</th>
                    <th className={thr}>{t('fields.taxBase')}</th>
                    <th className={thr}>{t('fields.taxAmount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {model.tax_summary.map((s) => (
                    <tr key={s.tax_code}>
                      <td className={td}>
                        {s.tax_code} ({percent(s.rate, locale)})
                      </td>
                      <td className={tdr}>{money(s.base, locale)}</td>
                      <td className={tdr}>{money(s.amount, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {model.amount_in_words && <p className="italic">{model.amount_in_words}</p>}
          </div>
          <dl className="grid min-w-64 grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            <dt>{t('totals.subtotal')}</dt>
            <dd className="text-right tabular-nums">{money(model.totals.subtotal, locale, cur)}</dd>
            <dt>{t('totals.discount')}</dt>
            <dd className="text-right tabular-nums">
              {money(model.totals.discount_total, locale, cur)}
            </dd>
            <dt>{t('totals.tax')}</dt>
            <dd className="text-right tabular-nums">
              {money(model.totals.tax_total, locale, cur)}
            </dd>
            <dt className="border-t border-foreground/40 pt-1 font-semibold">
              {t('totals.total')}
            </dt>
            <dd className="border-t border-foreground/40 pt-1 text-right font-semibold tabular-nums">
              {money(model.totals.total, locale, cur)}
            </dd>
          </dl>
        </div>
      )}
      {model.notes && (
        <p className="whitespace-pre-line">
          <span className="font-semibold">{t('fields.notes')}: </span>
          {model.notes}
        </p>
      )}
      {model.footer && <footer className="text-2xs text-muted-foreground">{model.footer}</footer>}
    </article>
  )
}
