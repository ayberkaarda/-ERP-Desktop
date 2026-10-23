import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Printer } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { LoadError } from '@/features/sales/invoices/kit/components/LoadError'
import { dec, money, percent, qty } from '@/features/sales/invoices/kit/money'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { useCompanyStore } from '@/stores/company'
import { http, seg } from '../http'
import { purchKeys, type DocBranch } from '../keys'
import { INVOICES_BASE, RECEIPTS_BASE, RETURNS_BASE } from '../links'
import type { Address, Envelope, PrintModel } from '../types'

const RESOURCE: Record<DocBranch, string> = {
  receipts: '/purchase-receipts',
  invoices: '/purchase-invoices',
  returns: '/purchase-returns',
}

const BACK: Record<DocBranch, string> = {
  receipts: RECEIPTS_BASE,
  invoices: INVOICES_BASE,
  returns: RETURNS_BASE,
}

// Only the sheet is printed: the app shell, header and buttons are hidden on paper.
const PRINT_CSS = `@media print {
  @page { size: A4; margin: 12mm; }
  body * { visibility: hidden !important; }
  .purch-print-sheet, .purch-print-sheet * { visibility: visible !important; }
  .purch-print-sheet { position: absolute; inset: 0 auto auto 0; width: 100%; box-shadow: none !important; border: 0 !important; }
}`

/** /purchasing/<resource>/:id/print — the print model as an A4 sheet; Ctrl+P or the button. */
export function PrintDocumentPage({ branch }: { branch: DocBranch }) {
  const { id = '' } = useParams()
  const { t } = useTranslation('purchasing-docs')
  useCompanyStore((s) => s.activeCompanyId)
  const model = useQuery({
    queryKey: purchKeys.print(branch, id),
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

function addressLines(a: Address | null | undefined): string {
  if (!a) return ''
  const city = [a.postal_code, a.district, a.city].filter(Boolean).join(' ')
  return [a.line1, a.line2, city, a.country].filter(Boolean).join('\n')
}

interface PartyBlockProps {
  title: string
  name: string | null
  address?: string
  taxOffice?: string | null
  taxNumber?: string | null
}

function PartyBlock({ title, name, address, taxOffice, taxNumber }: PartyBlockProps) {
  const { t } = useTranslation('purchasing-docs')
  return (
    <div className="space-y-0.5 text-sm">
      <p className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </p>
      <p className="font-semibold">{name ?? ''}</p>
      {address && <p className="whitespace-pre-line">{address}</p>}
      {(taxOffice ?? taxNumber) && (
        <p>{t('print.taxInfo', { office: taxOffice ?? '', number: taxNumber ?? '' })}</p>
      )}
    </div>
  )
}

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/** The sheet: company (buyer) and supplier, lines, tax and withholding per rate, totals. */
export function PrintSheet({ model }: { model: PrintModel }) {
  const { t } = useTranslation('purchasing-docs')
  const locale = useIntlLocale()
  const doc = model.document
  // A goods receipt is a warehouse document: quantities and lots, no prices.
  const priced = model.document_type !== 'purchase_receipt'
  const cur = doc.currency_code
  const title = t(`print.titles.${model.document_type}`)
  const company = model.company
  const supplierNo = text(doc.supplier_invoice_no)
  const hasLot = model.lines.some(
    (l) => (l.lot_no ?? '') !== '' || (l.serial_numbers?.length ?? 0) > 0,
  )
  const hasDiscount = model.lines.some((l) => !dec(l.discount_percent).isZero())
  const hasWithholding = !dec(model.totals.withholding_total).isZero()
  const th = 'border-b border-foreground/40 px-1.5 py-1 text-left font-semibold'
  const thr = `${th} text-right`
  const td = 'border-b border-border px-1.5 py-1 align-top'
  const tdr = `${td} text-right tabular-nums`

  return (
    <article
      className="purch-print-sheet space-y-5 rounded-lg border border-border bg-white p-8 text-[12px] text-black shadow-sm"
      aria-label={title}
      data-testid="print-sheet"
    >
      <header className="flex items-start justify-between gap-6">
        <PartyBlock
          title={t('print.buyer')}
          name={company.name}
          taxOffice={text(company.tax_office)}
          taxNumber={text(company.tax_number)}
        />
        <div className="text-right">
          <h1 className="text-xl font-semibold">{title}</h1>
          <dl className="mt-2 grid grid-cols-[auto_auto] justify-end gap-x-3 gap-y-0.5">
            <dt className="text-muted-foreground">{t('fields.number')}</dt>
            <dd className="font-code">{doc.number ?? t('print.draft')}</dd>
            {supplierNo && (
              <>
                <dt className="text-muted-foreground">{t('fields.supplierInvoiceNo')}</dt>
                <dd className="font-code">{supplierNo}</dd>
              </>
            )}
            <dt className="text-muted-foreground">{t('fields.documentDate')}</dt>
            <dd>{formatDate(doc.document_date, locale)}</dd>
            {priced && doc.due_date && (
              <>
                <dt className="text-muted-foreground">{t('fields.dueDate')}</dt>
                <dd>{formatDate(doc.due_date, locale)}</dd>
              </>
            )}
            {priced && !dec(doc.fx_rate).equals(1) && (
              <>
                <dt className="text-muted-foreground">{t('fields.fxRate')}</dt>
                <dd className="tabular-nums">
                  {cur} {qty(doc.fx_rate, locale)}
                </dd>
              </>
            )}
          </dl>
        </div>
      </header>
      <PartyBlock
        title={t('print.supplier')}
        name={model.party.name}
        address={addressLines(model.party.billing_address)}
        taxOffice={model.party.tax_office}
        taxNumber={model.party.tax_number}
      />
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
            {priced && hasWithholding && <th className={thr}>{t('fields.withholding')}</th>}
            {priced && <th className={thr}>{t('fields.netAmount')}</th>}
          </tr>
        </thead>
        <tbody>
          {model.lines.map((l) => (
            <tr key={l.line_no}>
              <td className={td}>{l.line_no}</td>
              <td className={td}>
                {l.item_code && <span className="font-code">{l.item_code} </span>}
                {l.description ?? l.item_name}
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
              {priced && hasWithholding && (
                <td className={tdr}>{money(l.withholding_amount, locale)}</td>
              )}
              {priced && <td className={tdr}>{money(l.net_amount, locale)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {priced && (
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0 flex-1 space-y-2">
            {model.taxes.length > 0 && (
              <table className="border-collapse text-[11px]">
                <thead>
                  <tr>
                    <th className={th}>{t('fields.taxRate')}</th>
                    <th className={thr}>{t('fields.taxBase')}</th>
                    <th className={thr}>{t('fields.taxAmount')}</th>
                    {hasWithholding && <th className={thr}>{t('fields.withholding')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {model.taxes.map((s) => (
                    <tr key={s.rate}>
                      <td className={td}>{percent(s.rate, locale)}</td>
                      <td className={tdr}>{money(s.base, locale)}</td>
                      <td className={tdr}>{money(s.tax, locale)}</td>
                      {hasWithholding && <td className={tdr}>{money(s.withholding, locale)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
            {hasWithholding && (
              <>
                <dt>{t('totals.withholding')}</dt>
                <dd className="text-right tabular-nums">
                  {money(model.totals.withholding_total, locale, cur)}
                </dd>
                <dt className="font-semibold">{t('totals.payable')}</dt>
                <dd className="text-right font-semibold tabular-nums" data-testid="print-payable">
                  {money(
                    dec(model.totals.total).minus(dec(model.totals.withholding_total)).toFixed(2),
                    locale,
                    cur,
                  )}
                </dd>
              </>
            )}
          </dl>
        </div>
      )}
      {doc.notes && (
        <p className="whitespace-pre-line">
          <span className="font-semibold">{t('fields.notes')}: </span>
          {doc.notes}
        </p>
      )}
    </article>
  )
}
