import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { edocumentsApi } from './api'
import { useEdocScope, useEdocT } from './hooks'
import type { EDocument } from './types'
import { Amount, ErrorNotice } from './ui'
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
function text(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}
export function SnapshotSheet({ record }: { record: EDocument }) {
  const t = useEdocT()
  const snapshot = record.snapshot ?? {}
  const supplier = object(snapshot.supplier)
  const customer = object(snapshot.customer)
  const parties: [string, Record<string, unknown>][] = [
    [t('supplier'), supplier],
    [t('customer'), customer],
  ]
  const rows = Array.isArray(snapshot.lines)
    ? snapshot.lines.filter((value) => value && typeof value === 'object').map(object)
    : []
  return (
    <article className="edoc-print-sheet space-y-6 rounded-md border border-border bg-surface p-5 text-sm">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
        <div>
          <h2 className="font-semibold">{t(record.kind)}</h2>
          <p className="font-mono">{record.number ?? t('unnumbered')}</p>
          <p className="text-xs text-muted-foreground">{record.uuid}</p>
        </div>
        <div className="text-right">
          <p className="font-semibold text-warning">{t('sandbox')}</p>
          <p className="text-xs text-muted-foreground">{t('printDisclaimer')}</p>
          <p>{record.document_date}</p>
        </div>
      </header>
      <div className="grid gap-6 sm:grid-cols-2">
        {parties.map(([label, value]) => {
          const party = object(value)
          const address = object(party.address)
          return (
            <section key={label} className="space-y-1">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground">{label}</h3>
              <p className="font-medium">{text(party.name)}</p>
              <p>{text(party.tax_number)}</p>
              <p className="whitespace-pre-line">
                {[
                  text(address.street),
                  [text(address.postal_code), text(address.district), text(address.city)]
                    .filter(Boolean)
                    .join(' '),
                  text(address.country_code),
                ]
                  .filter(Boolean)
                  .join('\n')}
              </p>
            </section>
          )
        })}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border">
              {[
                'line',
                'item',
                'quantity',
                'unit',
                ...(record.kind === 'e_despatch'
                  ? []
                  : ['unitPrice', 'netAmount', 'taxAmount', 'total']),
              ].map((key) => (
                <th key={key} className="whitespace-nowrap p-2">
                  {t(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((line, index) => (
              <tr key={text(line.id) || index} className="border-b border-border">
                <td className="p-2">{text(line.id) || index + 1}</td>
                <td className="p-2">
                  <p>{text(line.name)}</p>
                  <p className="text-muted-foreground">{text(line.item_code)}</p>
                </td>
                {[
                  'quantity',
                  'unit_code',
                  ...(record.kind === 'e_despatch'
                    ? []
                    : ['unit_price', 'net_amount', 'tax_amount', 'total']),
                ].map((key) => (
                  <td key={key} className="whitespace-nowrap p-2 tabular-nums">
                    {text(line[key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end border-t border-border pt-4">
        <div className="space-y-1 text-right">
          <p className="text-xs text-muted-foreground">{t('total')}</p>
          <p className="text-lg font-semibold">
            {record.kind === 'e_despatch' ? (
              <span aria-label={t('notApplicable')}>—</span>
            ) : (
              <Amount value={record.total} currency={record.currency_code} />
            )}
          </p>
        </div>
      </div>
    </article>
  )
}
const printCss =
  '@media print { @page { size:A4; margin:12mm } body *{visibility:hidden!important}.edoc-print-sheet,.edoc-print-sheet *{visibility:visible!important}.edoc-print-sheet{position:absolute;inset:0 auto auto 0;width:100%;border:0!important} }'
export function PrintPage() {
  const t = useEdocT()
  const scope = useEdocScope()
  const { id = '' } = useParams()
  const query = useQuery({
    queryKey: ['edocuments', scope.key, 'detail', id],
    queryFn: ({ signal }) => edocumentsApi.get(id, signal),
    enabled: scope.enabled && !!id,
  })
  return (
    <>
      <style>{printCss}</style>
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Button asChild variant="secondary">
          <Link to={`/edocuments/documents/${id}`}>{t('back')}</Link>
        </Button>
        <Button disabled={!query.data} onClick={() => window.print()}>
          {t('print')}
        </Button>
      </div>
      <ErrorNotice error={query.error} />
      {query.data ? (
        <SnapshotSheet record={query.data} />
      ) : (
        query.isPending && <p role="status">{t('loading')}</p>
      )}
    </>
  )
}
