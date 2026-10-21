import { CornerDownRight, Pencil, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DateInput, FieldShell } from '@/components/shared/form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toIsoDate, useIntlLocale } from '@/lib/datetime'
import { formatDecimal } from '@/lib/money'
import { platform } from '@/platform'
import { AccountTypeBadge } from '../../shared/components'
import { errorMessage, isVersionConflict } from '../../shared/errors'
import { useAccT } from '../../shared/i18n'
import { useAccountBalance, useDeleteAccount } from '../../shared/queries'
import type { Account } from '../../shared/types'

interface AccountDetailPanelProps {
  account: Account
  /** Root-to-parent chain for the breadcrumb. */
  path: readonly Account[]
  canManage: boolean
  onEdit: (account: Account) => void
  onAddChild: (account: Account) => void
  onClose: () => void
  onDeleted: () => void
}

function Flag({ on, label }: { on: boolean; label: string }) {
  const t = useAccT()
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{on ? t('common.yes') : t('common.no')}</dd>
    </div>
  )
}

/** Selected account: classification, flags and the balance as of a chosen date. */
export function AccountDetailPanel({
  account,
  path,
  canManage,
  onEdit,
  onAddChild,
  onClose,
  onDeleted,
}: AccountDetailPanelProps) {
  const t = useAccT()
  const locale = useIntlLocale()
  const [asOf, setAsOf] = useState(() => toIsoDate(new Date()))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const balance = useAccountBalance(account.id, asOf)
  const remove = useDeleteAccount()
  const b = balance.data

  const doDelete = async () => {
    try {
      await remove.mutateAsync({ id: account.id, version: account.version })
      platform.notify.success(t('accounts.toast.deleted'))
      onDeleted()
    } catch (error) {
      platform.notify.error(
        isVersionConflict(error)
          ? t('common.conflictBody')
          : errorMessage(error, t('common.actionFailed')),
      )
      throw error
    }
  }

  return (
    <aside
      aria-label={t('accounts.detail.title', { code: account.code })}
      className="space-y-4 rounded-md border border-border bg-surface p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          {path.length > 0 && (
            <p className="truncate text-xs text-muted-foreground">
              {path.map((p) => p.code).join(' › ')}
            </p>
          )}
          <h2 className="text-lg font-semibold">
            <span className="font-code">{account.code}</span> {account.name}
          </h2>
          <div className="flex flex-wrap gap-1">
            <AccountTypeBadge type={account.type} />
            <Badge>{t(`accounts.normal.${account.normal_balance}`)}</Badge>
            {account.is_postable ? (
              <Badge tone="success">{t('accounts.postable')}</Badge>
            ) : (
              <Badge>{t('accounts.header')}</Badge>
            )}
            {!account.is_active && <Badge tone="warning">{t('accounts.inactive')}</Badge>}
            {account.is_system && <Badge tone="info">{t('accounts.system')}</Badge>}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('accounts.detail.close')}
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </Button>
      </div>

      <section aria-labelledby={`bal-${account.id}`} className="space-y-2">
        <h3 id={`bal-${account.id}`} className="text-sm font-semibold">
          {t('accounts.detail.balance')}
        </h3>
        <FieldShell label={t('accounts.detail.asOf')}>
          {(control) => <DateInput {...control} value={asOf} onChange={setAsOf} />}
        </FieldShell>
        {balance.isLoading && <Skeleton className="h-16 w-full" />}
        {balance.isError && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(balance.error, t('accounts.detail.balanceFailed'))}
          </p>
        )}
        {b && (
          <dl
            className="grid grid-cols-3 gap-2 rounded-md bg-surface-sunken p-3 text-sm"
            aria-live="polite"
          >
            <div>
              <dt className="text-xs text-muted-foreground">{t('accounts.detail.debit')}</dt>
              <dd className="font-medium tabular-nums">{formatDecimal(b.debit, 2, locale)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('accounts.detail.credit')}</dt>
              <dd className="font-medium tabular-nums">{formatDecimal(b.credit, 2, locale)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('accounts.detail.net')}</dt>
              <dd className="font-semibold tabular-nums">
                {formatDecimal(b.balance, 2, locale)}{' '}
                <span className="text-xs font-normal text-muted-foreground">
                  {b.side ? t(`accounts.side.${b.side}`) : t('accounts.side.zero')}
                </span>
              </dd>
            </div>
            {b.fx_balance && b.currency_code && (
              <div className="col-span-3 text-xs text-muted-foreground">
                {t('accounts.detail.fxBalance', {
                  amount: formatDecimal(b.fx_balance, 2, locale),
                  currency: b.currency_code,
                })}
              </div>
            )}
          </dl>
        )}
      </section>

      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{t('accounts.fields.tdhpGroup')}</dt>
          <dd>{account.tdhp_group ?? '—'}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{t('accounts.fields.currency')}</dt>
          <dd className="font-code">{account.currency_code ?? '—'}</dd>
        </div>
        <Flag on={account.requires_party} label={t('accounts.fields.requiresParty')} />
        <Flag on={account.requires_cost_center} label={t('accounts.fields.requiresCostCenter')} />
        <Flag on={account.requires_project} label={t('accounts.fields.requiresProject')} />
        <Flag on={account.is_revaluable} label={t('accounts.fields.isRevaluable')} />
      </dl>
      {account.notes && <p className="text-sm whitespace-pre-line">{account.notes}</p>}

      {canManage && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button size="sm" variant="secondary" onClick={() => onEdit(account)}>
            <Pencil aria-hidden="true" />
            {t('accounts.edit')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onAddChild(account)}>
            <CornerDownRight aria-hidden="true" />
            {t('accounts.addChild')}
          </Button>
          {!account.is_system && (
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden="true" />
              {t('accounts.delete')}
            </Button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('accounts.deleteTitle', { code: account.code })}
        description={t('accounts.deleteBody')}
        confirmLabel={t('accounts.delete')}
        onConfirm={doDelete}
      />
    </aside>
  )
}
