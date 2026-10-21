import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Ban, CheckCircle2, FileMinus, PackageCheck, Printer, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { AuditTrail } from '@/components/shared/AuditTrail'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { formatDate, formatDateTime, useIntlLocale } from '@/lib/datetime'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { DocLinks } from '../../invoices/kit/components/DocLinks'
import { ReturnStatusBadge } from '../../invoices/kit/components/StatusBadges'
import { errorMessage } from '../../invoices/kit/http'
import { activeCompany, salesDocsKeys } from '../../invoices/kit/keys'
import { RETURNS_BASE, linkTo } from '../../invoices/kit/links'
import { money, qty } from '../../invoices/kit/money'
import { SALES_PERMS } from '../../invoices/kit/permissions'
import { returnsApi, type SalesReturn } from '../api'
import { cancellable, nextAction } from '../lib/selection'
import type { ReturnAction } from '../types'
import { ReturnActionDialog } from './ReturnActionDialog'

const STEP_ICON = { approve: CheckCircle2, receive: PackageCheck, credit: FileMinus } as const
const STEP_PERM = {
  approve: SALES_PERMS.returns.approve,
  receive: SALES_PERMS.returns.receive,
  credit: SALES_PERMS.returns.credit,
} as const

/** A return with its next step (approve, receive, credit), cancel, links and audit. */
export function ReturnView({ ret, onReload }: { ret: SalesReturn; onReload: () => void }) {
  const { t } = useTranslation('sales-docs')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [action, setAction] = useState<ReturnAction | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const step = nextAction(ret.status)
  const canStep = usePermission(step ? STEP_PERM[step] : undefined)
  const canCancel = usePermission(SALES_PERMS.returns.update)
  const canDelete = usePermission(SALES_PERMS.returns.delete)
  const canStock = usePermission(SALES_PERMS.stockDocumentView)
  const StepIcon = step ? STEP_ICON[step] : null
  const cur = ret.currency_code

  const remove = useMutation<unknown, Error, { company: string }>({
    mutationFn: () => returnsApi.remove(ret.id, ret.version),
    onSuccess: (_, { company }) => {
      void queryClient.invalidateQueries({ queryKey: salesDocsKeys.branch('returns', company) })
      if (activeCompany() !== company) return
      platform.notify.success(t('editor.deleted'))
      void navigate(RETURNS_BASE)
    },
    onError: (error) => platform.notify.error(errorMessage(error, t('errors.generic'))),
  })

  const facts: [string, ReactNode][] = [
    [t('fields.customer'), ret.party_snapshot?.name ?? ret.party_name ?? ''],
    [t('fields.documentDate'), formatDate(ret.document_date, locale)],
    [
      t('return.invoice'),
      <Link
        key="i"
        to={linkTo('sales_invoice', ret.invoice_id)}
        className="font-code text-primary hover:underline"
      >
        {ret.invoice_number ?? t('links.unnumbered')}
      </Link>,
    ],
  ]
  if (ret.reason) facts.push([t('fields.reason'), ret.reason])
  if (ret.received_at) facts.push([t('fields.receivedAt'), formatDateTime(ret.received_at, locale)])
  if (ret.stock_document_id)
    facts.push([
      t('fields.stockDocument'),
      canStock ? (
        <Link
          key="s"
          to={linkTo('stock_document', ret.stock_document_id)}
          className="text-primary hover:underline"
        >
          {t('view.open')}
        </Link>
      ) : (
        t('view.posted')
      ),
    ])
  if (ret.credit_invoice_id)
    facts.push([
      t('return.creditNote'),
      <Link
        key="c"
        to={linkTo('sales_invoice', ret.credit_invoice_id)}
        className="font-code text-primary hover:underline"
      >
        {ret.credit_invoice_number ?? t('links.unnumbered')}
      </Link>,
    ])
  if (ret.total) facts.push([t('fields.total'), money(ret.total, locale, cur)])
  if (ret.notes) facts.push([t('fields.notes'), ret.notes])

  const th = 'h-row border-b border-border px-2 text-left font-medium whitespace-nowrap'
  const thr = `${th} text-right`
  const td = 'border-b border-border px-2 py-1'
  const tdr = `${td} text-right tabular-nums`

  return (
    <div className="mx-auto max-w-[1440px] space-y-4 px-6 py-6">
      <PageHeader
        title={t('return.viewTitle', { number: ret.number ?? '' })}
        breadcrumbs={[
          { label: t('nav.sales') },
          { label: t('return.listTitle'), to: RETURNS_BASE },
          { label: ret.number ?? t('links.unnumbered') },
        ]}
        meta={<ReturnStatusBadge status={ret.status} />}
        actions={
          <>
            {ret.status !== 'draft' && (
              <Button asChild variant="secondary">
                <Link to={`${RETURNS_BASE}/${ret.id}/print`}>
                  <Printer aria-hidden="true" />
                  {t('print.open')}
                </Link>
              </Button>
            )}
            {ret.status === 'draft' && canDelete && (
              <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)}>
                <Trash2 aria-hidden="true" />
                {t('editor.delete')}
              </Button>
            )}
            {cancellable(ret.status) && canCancel && (
              <Button type="button" variant="secondary" onClick={() => setAction('cancel')}>
                <Ban aria-hidden="true" />
                {t('returnAction.cancel.button')}
              </Button>
            )}
            {step && StepIcon && canStep && (
              <Button type="button" onClick={() => setAction(step)}>
                <StepIcon aria-hidden="true" />
                {t(`returnAction.${step}.button`)}
              </Button>
            )}
          </>
        }
      />
      <ol aria-label={t('return.steps')} className="flex flex-wrap gap-2 text-xs">
        {(['draft', 'approved', 'received', 'credited'] as const).map((s, i, all) => {
          const reached = ret.status !== 'cancelled' && all.indexOf(ret.status) >= i
          return (
            <li
              key={s}
              aria-current={ret.status === s ? 'step' : undefined}
              className={
                reached
                  ? 'rounded-full bg-primary-soft px-2.5 py-1 font-medium text-primary-soft-foreground'
                  : 'rounded-full bg-surface-sunken px-2.5 py-1 text-muted-foreground'
              }
            >
              {t(`returnStatus.${s}`)}
            </li>
          )
        })}
      </ol>
      <dl className="grid gap-x-6 gap-y-2 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table
          className="w-full border-separate border-spacing-0 text-table"
          aria-label={t('return.lines')}
        >
          <thead className="bg-surface-sunken text-xs text-muted-foreground">
            <tr>
              <th className={thr}>#</th>
              <th className={th}>{t('fields.item')}</th>
              <th className={thr}>{t('fields.quantity')}</th>
              <th className={th}>{t('fields.unit')}</th>
              <th className={th}>{t('fields.lotSerial')}</th>
              <th className={thr}>{t('fields.lineTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {ret.lines.map((l) => (
              <tr key={l.id}>
                <td className={tdr}>{l.line_no}</td>
                <td className={td}>
                  {l.item_code && <span className="font-code">{l.item_code} </span>}
                  {l.item_name ?? l.description}
                </td>
                <td className={tdr}>{qty(l.quantity, locale)}</td>
                <td className={td}>{l.unit_code ?? ''}</td>
                <td className={`${td} font-code`}>
                  {[l.lot_no, ...l.serial_numbers].filter(Boolean).join(', ')}
                </td>
                <td className={tdr}>{money(l.line_total, locale, cur)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DocLinks links={ret.links} />
      {ret.audit && ret.audit.length > 0 && <AuditTrail entries={ret.audit} />}
      <ReturnActionDialog
        ret={ret}
        action={action}
        onClose={() => setAction(null)}
        onReload={onReload}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('editor.deleteTitle')}
        description={t('editor.deleteBody')}
        confirmLabel={t('editor.delete')}
        onConfirm={async () => {
          await remove.mutateAsync({ company: activeCompany() })
        }}
      />
    </div>
  )
}
