import { useNavigate } from 'react-router'
import { Checkbox } from '@/components/ui/checkbox'
import { activeCompany } from '../shared/keys'
import { treasuryApi } from '../shared/api'
import type { Account } from '../shared/types'
import { EnumField, ErrorNotice, FormButtons, LedgerField, Panel, TextField } from '../shared/ui'
import { useFormValue, useTreasuryMutation, useTreasuryT } from '../shared/hooks'

export function AccountEditor({
  record,
  onCancel,
  onSaved,
}: {
  record?: Account
  onCancel?: () => void
  onSaved?: (record: Account) => void
}) {
  const t = useTreasuryT()
  const navigate = useNavigate()
  const [form, set] = useFormValue({
    type: record?.type ?? 'cash',
    code: record?.code ?? '',
    name: record?.name ?? '',
    currency_code: record?.currency_code ?? 'TRY',
    gl_account_id: record?.gl_account_id ?? '',
    bank_name: record?.bank_name ?? '',
    branch: record?.branch ?? '',
    iban: record?.iban ?? '',
    is_active: record?.is_active ?? true,
    allow_negative: record?.allow_negative ?? false,
  })
  const mutation = useTreasuryMutation<Account>(
    `accounts:${record?.id ?? 'new'}`,
    (body, key) =>
      record
        ? treasuryApi.update('accounts', record.id, body)
        : treasuryApi.create('accounts', body, key),
    (result) => (onSaved ? onSaved(result) : void navigate(`/treasury/accounts/${result.id}`)),
  )
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        mutation.mutate({
          body: { ...form, ...(record ? { version: record.version } : {}) },
          company: activeCompany(),
        })
      }}
    >
      <Panel>
        <div className="grid gap-4 sm:grid-cols-2">
          <EnumField
            name="type"
            value={form.type}
            onChange={(v) => set('type', v as Account['type'])}
            options={['cash', 'bank', 'pos']}
          />
          <TextField name="code" value={form.code} onChange={(v) => set('code', v)} required />
          <TextField name="name" value={form.name} onChange={(v) => set('name', v)} required />
          <TextField
            name="currency_code"
            value={form.currency_code}
            onChange={(v) => set('currency_code', v.toUpperCase())}
            required
          />
          <LedgerField value={form.gl_account_id} onChange={(v) => set('gl_account_id', v)} />
          {form.type !== 'cash' && (
            <>
              <TextField
                name="bank_name"
                value={form.bank_name}
                onChange={(v) => set('bank_name', v)}
              />
              <TextField name="branch" value={form.branch} onChange={(v) => set('branch', v)} />
              <TextField name="iban" value={form.iban} onChange={(v) => set('iban', v)} />
            </>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.is_active}
              onChange={(e) => set('is_active', e.target.checked)}
            />
            {t('is_active')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.allow_negative}
              onChange={(e) => set('allow_negative', e.target.checked)}
            />
            {t('allow_negative')}
          </label>
        </div>
      </Panel>
      <ErrorNotice error={mutation.error} />
      <FormButtons
        pending={mutation.isPending}
        onCancel={onCancel ?? (() => void navigate('/treasury/accounts'))}
      />
    </form>
  )
}
