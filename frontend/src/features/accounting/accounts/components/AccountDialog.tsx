import { zodResolver } from '@hookform/resolvers/zod'
import { Info, ShieldAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { FieldShell } from '@/components/shared/form'
import { platform } from '@/platform'
import { AccountCombobox } from '../../shared/AccountCombobox'
import { accountsApi } from '../../shared/api'
import { usePayloadKeys } from '../../shared/idempotency'
import { useAccT, type AccT } from '../../shared/i18n'
import {
  CheckboxField,
  RecordDialog,
  SelectField,
  TextAreaField,
  TextField,
} from '../../shared/form'
import { useSaveAccount } from '../../shared/queries'
import { ACCOUNT_TYPES, NORMAL_BALANCES, type Account } from '../../shared/types'
import { accountSchema, diff, toInput, toValues, type AccountFormValues } from '../lib/accountForm'
import { checkIntegrity, CODE_MAX, type IntegrityIssue } from '../lib/integrity'

const issueText = (t: AccT, issue: IntegrityIssue) => t(issue.key, issue.params)

interface AccountDialogProps {
  /** null creates; `parent` preselects the parent of a new account. */
  account: Account | null
  parent?: Account | null
  /** Whole chart (tree data) for the client-side integrity checks. */
  accounts: readonly Account[]
  onClose: () => void
  onSaved?: (account: Account) => void
}

export function AccountDialog({
  account: initial,
  parent = null,
  accounts,
  onClose,
  onSaved,
}: AccountDialogProps) {
  const t = useAccT()
  const [account, setAccount] = useState(initial)
  const [reloading, setReloading] = useState(false)
  const keyFor = usePayloadKeys()
  const save = useSaveAccount()
  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: toValues(initial, parent),
  })
  const watched = useWatch({ control: form.control })
  const report = useMemo(
    () =>
      checkIntegrity(
        {
          code: watched.code ?? '',
          parentId: watched.parent_id ?? null,
          isPostable: watched.is_postable ?? true,
          isActive: watched.is_active ?? true,
          type: watched.type ?? 'asset',
          normalBalance: watched.normal_balance ?? 'debit',
        },
        { accounts, editing: account },
      ),
    [watched, accounts, account],
  )

  const labels: Record<string, string> = {
    code: t('accounts.fields.code'),
    name: t('accounts.fields.name'),
    parent_id: t('accounts.fields.parent'),
    type: t('accounts.fields.type'),
    normal_balance: t('accounts.fields.normalBalance'),
    is_postable: t('accounts.fields.isPostable'),
    is_active: t('accounts.fields.isActive'),
    tdhp_group: t('accounts.fields.tdhpGroup'),
    currency_code: t('accounts.fields.currency'),
    requires_party: t('accounts.fields.requiresParty'),
    requires_cost_center: t('accounts.fields.requiresCostCenter'),
    requires_project: t('accounts.fields.requiresProject'),
    is_revaluable: t('accounts.fields.isRevaluable'),
    notes: t('accounts.fields.notes'),
  }

  const submit = (values: AccountFormValues) => {
    const blocking = Object.entries(report.errors)
    if (blocking.length > 0) {
      const map: Record<string, keyof AccountFormValues> = {
        code: 'code',
        parentId: 'parent_id',
        isPostable: 'is_postable',
        isActive: 'is_active',
      }
      for (const [field, issue] of blocking) {
        const target = map[field]
        if (target) form.setError(target, { type: 'integrity', message: issueText(t, issue) })
      }
      return
    }
    const input = toInput(values)
    const done = (saved: Account) => {
      platform.notify.success(t(account ? 'accounts.toast.updated' : 'accounts.toast.created'))
      onSaved?.(saved)
      onClose()
    }
    if (account) {
      const patch = diff(toInput(toValues(account)), input)
      if (Object.keys(patch).length === 0) {
        onClose()
        return
      }
      save.mutate(
        { mode: 'update', id: account.id, version: account.version, patch },
        { onSuccess: done },
      )
    } else {
      save.mutate({ mode: 'create', input, key: keyFor(input) }, { onSuccess: done })
    }
  }

  const reload = async () => {
    if (!account) return
    setReloading(true)
    try {
      const fresh = await accountsApi.get(account.id)
      setAccount(fresh)
      save.reset()
      form.reset(toValues(fresh))
    } catch {
      platform.notify.error(t('common.loadFailed'))
    } finally {
      setReloading(false)
    }
  }

  const typeOptions = ACCOUNT_TYPES.map((v) => ({ value: v, label: t(`accounts.types.${v}`) }))
  const balanceOptions = NORMAL_BALANCES.map((v) => ({
    value: v,
    label: t(`accounts.normal.${v}`),
  }))
  const groupOptions = Array.from({ length: 9 }, (_, i) => ({
    value: String(i + 1),
    label: t('accounts.tdhpGroupOption', { group: i + 1, name: t(`accounts.tdhp.${i + 1}`) }),
  }))
  const blocking = Object.values(report.errors).filter((x): x is IntegrityIssue => Boolean(x))

  return (
    <RecordDialog<AccountFormValues>
      open
      onOpenChange={(o) => !o && onClose()}
      title={account ? t('accounts.editTitle', { code: account.code }) : t('accounts.newTitle')}
      description={account?.is_system ? t('accounts.systemNote') : undefined}
      form={form}
      onSubmit={submit}
      error={save.error}
      onReload={account ? () => void reload() : undefined}
      reloading={reloading}
      busy={save.isPending}
      fieldLabels={labels}
      className="max-w-3xl"
    >
      {(blocking.length > 0 || report.warnings.length > 0) && (
        <section aria-label={t('accounts.integrity.title')} className="space-y-2">
          {blocking.length > 0 && (
            <div className="flex gap-2 rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger-soft-foreground">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <ul className="space-y-0.5">
                {blocking.map((issue) => (
                  <li key={issue.key}>{issueText(t, issue)}</li>
                ))}
              </ul>
            </div>
          )}
          {report.warnings.length > 0 && (
            <div className="flex gap-2 rounded-md border border-info/30 bg-info-soft p-3 text-sm text-info-soft-foreground">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <ul className="space-y-0.5">
                {report.warnings.map((issue) => (
                  <li key={issue.key}>{issueText(t, issue)}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField<AccountFormValues, 'code'>
          name="code"
          label={labels.code ?? ''}
          required
          description={t('accounts.hints.code')}
          input={{
            autoComplete: 'off',
            className: 'font-code',
            maxLength: CODE_MAX,
            disabled: account?.is_system,
          }}
        />
        <TextField<AccountFormValues, 'name'>
          name="name"
          label={labels.name ?? ''}
          required
          input={{ maxLength: 255 }}
        />
        <Controller
          control={form.control}
          name="parent_id"
          render={({ field, fieldState }) => (
            <FieldShell
              label={labels.parent_id ?? ''}
              className="sm:col-span-2"
              description={t('accounts.hints.parent')}
              error={fieldState.error?.message}
            >
              {(control) => (
                <AccountCombobox
                  {...control}
                  ref={field.ref}
                  value={field.value}
                  postableOnly={false}
                  disabled={account?.is_system}
                  onBlur={field.onBlur}
                  onChange={(id, picked) => {
                    field.onChange(id)
                    if (!account && picked) {
                      // A new child inherits classification from its parent.
                      form.setValue('type', picked.type)
                      form.setValue('normal_balance', picked.normal_balance)
                      if (picked.tdhp_group) form.setValue('tdhp_group', String(picked.tdhp_group))
                      if (!form.getValues('code').trim()) form.setValue('code', picked.code)
                    }
                  }}
                />
              )}
            </FieldShell>
          )}
        />
        <SelectField<AccountFormValues, 'type'>
          name="type"
          label={labels.type ?? ''}
          required
          options={typeOptions}
          disabled={account?.is_system}
        />
        <SelectField<AccountFormValues, 'normal_balance'>
          name="normal_balance"
          label={labels.normal_balance ?? ''}
          required
          options={balanceOptions}
          disabled={account?.is_system}
        />
        <SelectField<AccountFormValues, 'tdhp_group'>
          name="tdhp_group"
          label={labels.tdhp_group ?? ''}
          options={groupOptions}
          emptyLabel={t('accounts.noGroup')}
        />
        <TextField<AccountFormValues, 'currency_code'>
          name="currency_code"
          label={labels.currency_code ?? ''}
          description={t('accounts.hints.currency')}
          input={{ maxLength: 3, className: 'font-code uppercase', autoComplete: 'off' }}
        />
        <fieldset className="grid gap-3 rounded-md border border-border p-3 sm:col-span-2 sm:grid-cols-2">
          <legend className="px-1 text-xs font-medium text-muted-foreground">
            {t('accounts.flagsLegend')}
          </legend>
          <CheckboxField<AccountFormValues>
            name="is_postable"
            label={labels.is_postable ?? ''}
            description={t('accounts.hints.postable')}
            error={report.errors.isPostable ? issueText(t, report.errors.isPostable) : undefined}
          />
          <CheckboxField<AccountFormValues> name="is_active" label={labels.is_active ?? ''} />
          <CheckboxField<AccountFormValues>
            name="requires_party"
            label={labels.requires_party ?? ''}
          />
          <CheckboxField<AccountFormValues>
            name="requires_cost_center"
            label={labels.requires_cost_center ?? ''}
          />
          <CheckboxField<AccountFormValues>
            name="requires_project"
            label={labels.requires_project ?? ''}
          />
          <CheckboxField<AccountFormValues>
            name="is_revaluable"
            label={labels.is_revaluable ?? ''}
            disabled={!watched.currency_code?.trim()}
            description={t('accounts.hints.revaluable')}
          />
        </fieldset>
        <TextAreaField<AccountFormValues, 'notes'>
          name="notes"
          label={labels.notes ?? ''}
          maxLength={2000}
          className="sm:col-span-2"
        />
      </div>
    </RecordDialog>
  )
}
