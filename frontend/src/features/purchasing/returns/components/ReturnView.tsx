import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Ban, CheckCircle2, FileMinus, Loader2, Printer, Trash2, Truck } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { AuditTrail } from '@/components/shared/AuditTrail'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ActionError } from '@/features/sales/invoices/kit/components/ActionError'
import { money, qty } from '@/features/sales/invoices/kit/money'
import { useCompanyCurrency } from '@/features/sales/invoices/kit/viewKey'
import { VersionConflictAlert } from '@/features/sales/shared/components/common'
import { formatDate, formatDateTime, useIntlLocale } from '@/lib/datetime'
import { usePermission } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { platform } from '@/platform'
import { DocLinks } from '../../invoices/kit/components/DocLinks'
import { ReturnStatusBadge } from '../../invoices/kit/components/StatusBadges'
import { errorMessage, isVersionConflict } from '../../invoices/kit/http'
import { activeCompany, invalidatePurchEffects, purchKeys } from '../../invoices/kit/keys'
import { INVOICES_BASE, RECEIPTS_BASE, RETURNS_BASE, linkTo } from '../../invoices/kit/links'
import { linkNamed } from '../../invoices/kit/normalize'
import { PURCH_PERMS } from '../../invoices/kit/permissions'
import { returnsApi } from '../api'
import { returnStepKeys } from '../lib/stepKeys'
import type { PurchaseReturn, ReturnAction } from '../types'

const STEPS = ['draft', 'approved', 'shipped', 'debited'] as const

interface ReturnViewProps {
  ret: PurchaseReturn
  onReload: () => void
}

/**
 * A return and its steps: approve (number PRT) -> ship (stock out at receipt cost) -> debit
 * (debit note reversing payable and VAT; invoice returns only). Cancel before shipping.
 */
export function ReturnView({ ret, onReload }: ReturnViewProps) {
  const { t } = useTranslation('purchasing-docs')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const companyCurrency = useCompanyCurrency()
  const canApprove = usePermission(PURCH_PERMS.returns.approve)
  const canShip = usePermission(PURCH_PERMS.returns.ship)
  const canDebit = usePermission(PURCH_PERMS.returns.debit)
  const canCancel = usePermission(PURCH_PERMS.returns.update)
  const canDelete = usePermission(PURCH_PERMS.returns.delete)
  const canJournal = usePermission(PURCH_PERMS.journalView)
  const canStock = usePermission(PURCH_PERMS.stockDocumentView)
  const [action, setAction] = useState<ReturnAction | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const fromInvoice = ret.invoice_id !== null
  const invoice = linkNamed(ret.raw_links, 'invoice')
  const receipt = linkNamed(ret.raw_links, 'receipt')
  const debitNote = linkNamed(ret.raw_links, 'debit_invoice')

  const remove = useMutation<unknown, Error, { company: string }>({
    mutationFn: () => returnsApi.remove(ret.id, ret.version),
    onSuccess: (_, { company }) => {
      invalidatePurchEffects(queryClient, company)
      if (activeCompany() !== company) return
      platform.notify.success(t('editor.deleted'))
      void navigate(RETURNS_BASE)
    },
  })

  const available: {
    action: ReturnAction
    allowed: boolean
    icon: typeof Truck
    danger?: boolean
  }[] = [
    { action: 'approve', allowed: ret.status === 'draft' && canApprove, icon: CheckCircle2 },
    { action: 'ship', allowed: ret.status === 'approved' && canShip, icon: Truck },
    {
      action: 'debit',
      allowed: ret.status === 'shipped' && fromInvoice && canDebit,
      icon: FileMinus,
    },
    {
      action: 'cancel',
      allowed: (ret.status === 'draft' || ret.status === 'approved') && canCancel,
      icon: Ban,
      danger: true,
    },
  ]

  const docLink = (allowed: boolean, to: string, label: string) =>
    allowed ? (
      <Link to={to} className="text-primary hover:underline">
        {label}
      </Link>
    ) : (
      label
    )

  const facts: [string, ReactNode][] = [
    [t('fields.supplier'), ret.party_snapshot.name || (ret.party_name ?? '')],
    [t('fields.documentDate'), formatDate(ret.document_date, locale)],
  ]
  if (invoice)
    facts.push([
      t('return.sourceInvoice'),
      <Link
        key="i"
        to={`${INVOICES_BASE}/${encodeURIComponent(invoice.id)}`}
        className="font-code text-primary hover:underline"
      >
        {invoice.number ?? t('links.unnumbered')}
      </Link>,
    ])
  if (receipt)
    facts.push([
      t('return.sourceReceipt'),
      <Link
        key="r"
        to={`${RECEIPTS_BASE}/${encodeURIComponent(receipt.id)}`}
        className="font-code text-primary hover:underline"
      >
        {receipt.number ?? t('links.unnumbered')}
      </Link>,
    ])
  if (ret.reason) facts.push([t('fields.reason'), ret.reason])
  if (ret.shipped_at) facts.push([t('return.shippedAt'), formatDateTime(ret.shipped_at, locale)])
  if (ret.stock_document_id)
    facts.push([
      t('fields.stockDocument'),
      docLink(canStock, linkTo('stock_document', ret.stock_document_id), t('view.stockDocument')),
    ])
  if (ret.journal_entry_id)
    facts.push([
      t('return.costEntry'),
      docLink(canJournal, linkTo('journal_entry', ret.journal_entry_id), t('view.journalEntry')),
    ])
  if (debitNote)
    facts.push([
      t('return.debitNote'),
      <Link
        key="d"
        to={`${INVOICES_BASE}/${encodeURIComponent(debitNote.id)}`}
        className="font-code text-primary hover:underline"
        data-testid="debit-note-link"
      >
        {debitNote.number ?? t('links.unnumbered')}
      </Link>,
    ])
  if (ret.notes) facts.push([t('fields.notes'), ret.notes])

  const steps = fromInvoice ? STEPS : STEPS.slice(0, 3)
  const reached = steps.indexOf(ret.status as (typeof STEPS)[number])

  const th = 'h-row border-b border-border px-2 text-left font-medium whitespace-nowrap'
  const thr = `${th} text-right`
  const td = 'border-b border-border px-2 py-1 align-top'
  const tdr = `${td} text-right tabular-nums`

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-6 py-6">
      <PageHeader
        title={t('return.viewTitle', { number: ret.number ?? '' })}
        breadcrumbs={[
          { label: t('nav.purchasing') },
          { label: t('return.listTitle'), to: RETURNS_BASE },
          { label: ret.number ?? t('links.unnumbered') },
        ]}
        meta={<ReturnStatusBadge status={ret.status} />}
        actions={
          <>
            <Button asChild variant="secondary">
              <Link to={`${RETURNS_BASE}/${ret.id}/print`}>
                <Printer aria-hidden="true" />
                {t('print.open')}
              </Link>
            </Button>
            {ret.status === 'draft' && canDelete && (
              <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)}>
                <Trash2 aria-hidden="true" />
                {t('editor.delete')}
              </Button>
            )}
            {available
              .filter((a) => a.allowed)
              .map((a) => (
                <Button
                  key={a.action}
                  type="button"
                  variant={a.danger ? 'ghost' : 'primary'}
                  onClick={() => setAction(a.action)}
                >
                  <a.icon aria-hidden="true" />
                  {t(`return.actions.${a.action}`)}
                </Button>
              ))}
          </>
        }
      />
      {ret.status !== 'cancelled' && (
        <ol className="flex flex-wrap gap-2 text-xs" aria-label={t('return.steps')}>
          {steps.map((s, i) => (
            <li
              key={s}
              aria-current={i === reached ? 'step' : undefined}
              className={cn(
                'rounded-full px-3 py-1',
                i < reached && 'bg-success-soft text-success-soft-foreground',
                i === reached && 'bg-primary-soft font-medium text-primary-soft-foreground',
                i > reached && 'bg-surface-sunken text-muted-foreground',
              )}
            >
              {t(`returnStatus.${s}`)}
            </li>
          ))}
        </ol>
      )}
      {ret.status === 'shipped' && !fromInvoice && (
        <p role="note" className="text-sm text-muted-foreground">
          {t('return.receiptEndsShipped')}
        </p>
      )}
      <dl className="grid content-start gap-x-6 gap-y-2 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
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
              <th className={th}>{t('fields.lotNo')}</th>
              <th className={th}>{t('fields.serials')}</th>
              {fromInvoice && <th className={thr}>{t('fields.netAmount')}</th>}
              <th className={thr}>{t('return.receiptCost')}</th>
              <th className={thr}>{t('fields.costTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {ret.lines.map((l) => (
              <tr key={l.id}>
                <td className={tdr}>{l.line_no}</td>
                <td className={td}>
                  {l.item_code && <span className="font-code">{l.item_code} </span>}
                  {l.description ?? l.item_name}
                </td>
                <td className={tdr}>{qty(l.quantity, locale)}</td>
                <td className={td}>{l.unit_code ?? ''}</td>
                <td className={`${td} font-code`}>{l.lot_no ?? ''}</td>
                <td className={`${td} font-code text-xs`}>{l.serial_numbers.join(', ')}</td>
                {fromInvoice && (
                  <td className={tdr}>{money(l.net_amount, locale, ret.currency_code)}</td>
                )}
                <td className={tdr}>
                  {l.receipt_cost ? money(l.receipt_cost, locale, companyCurrency) : ''}
                </td>
                <td className={tdr}>
                  {l.cost_total ? money(l.cost_total, locale, companyCurrency) : ''}
                </td>
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
          try {
            await remove.mutateAsync({ company: activeCompany() })
          } catch (error) {
            platform.notify.error(errorMessage(error, t('errors.generic')))
            throw error
          }
        }}
      />
    </div>
  )
}

interface ReturnActionDialogProps {
  ret: PurchaseReturn
  action: ReturnAction | null
  onClose: () => void
  onReload: () => void
}

/** Confirms one step; POST /purchase-returns/{id}/<step> {version} with a payload-bound key. */
function ReturnActionDialog({ ret, action, onClose, onReload }: ReturnActionDialogProps) {
  const { t } = useTranslation('purchasing-docs')
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: ({ step }: { step: ReturnAction; company: string }) => {
      const payload = { id: ret.id, step, version: ret.version }
      return returnsApi.act(ret.id, step, ret.version, returnStepKeys.keyFor(payload))
    },
    onSuccess: (saved, { step, company }) => {
      returnStepKeys.release({ id: ret.id, step, version: ret.version })
      queryClient.setQueryData(purchKeys.detail('returns', saved.id, company), saved)
      invalidatePurchEffects(queryClient, company)
      if (activeCompany() !== company) return
      platform.notify.success(t(`return.done.${step}`))
      onClose()
    },
  })
  const conflict = isVersionConflict(mutation.error)
  const open = action !== null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (mutation.isPending || next) return
        mutation.reset()
        onClose()
      }}
    >
      <DialogContent closeLabel={t('actions.close')} aria-busy={mutation.isPending}>
        {action && (
          <>
            <DialogHeader>
              <DialogTitle>{t(`return.actions.${action}`)}</DialogTitle>
              <DialogDescription>{t(`return.confirm.${action}`)}</DialogDescription>
            </DialogHeader>
            {conflict ? (
              <VersionConflictAlert
                onReload={() => {
                  mutation.reset()
                  onClose()
                  onReload()
                }}
              />
            ) : (
              <ActionError error={mutation.error} />
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={mutation.isPending}
                onClick={() => {
                  mutation.reset()
                  onClose()
                }}
              >
                {t('actions.cancel')}
              </Button>
              <Button
                type="button"
                variant={action === 'cancel' ? 'danger' : 'primary'}
                disabled={mutation.isPending || conflict}
                onClick={() => mutation.mutate({ step: action, company: activeCompany() })}
              >
                {mutation.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
                {t(`return.actions.${action}`)}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
