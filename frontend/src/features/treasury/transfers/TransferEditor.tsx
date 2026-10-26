import { useNavigate } from 'react-router'
import { toIsoDate } from '@/lib/datetime'
import { treasuryApi } from '../shared/api'
import { activeCompany } from '../shared/keys'
import type { Transfer } from '../shared/types'
import {
  AccountField,
  DateField,
  ErrorNotice,
  FormButtons,
  LedgerField,
  MoneyField,
  Panel,
} from '../shared/ui'
import { useAccounts, useFormValue, useTreasuryMutation } from '../shared/hooks'

export function TransferEditor({
  record,
  onCancel,
  onSaved,
}: {
  record?: Transfer
  onCancel?: () => void
  onSaved?: (record: Transfer) => void
}) {
  const navigate = useNavigate()
  const accounts = useAccounts()
  const [form, set] = useFormValue({
    from_account_id: record?.from_account_id ?? '',
    to_account_id: record?.to_account_id ?? '',
    document_date: record?.document_date ?? toIsoDate(new Date()),
    amount: record?.amount ?? '',
    target_amount: record?.target_amount ?? '',
    source_fx_rate: record?.source_fx_rate ?? '1',
    target_fx_rate: record?.target_fx_rate ?? '1',
    fee_amount: record?.fee_amount ?? '0',
    expense_account_id: record?.expense_account_id ?? '',
  })
  const mutation = useTreasuryMutation<Transfer>(
    `transfers:${record?.id ?? 'new'}`,
    (body, key) =>
      record
        ? treasuryApi.update('transfers', record.id, body)
        : treasuryApi.create('transfers', body, key),
    (r) => (onSaved ? onSaved(r) : void navigate(`/treasury/transfers/${r.id}`)),
  )
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        mutation.mutate({
          body: {
            ...form,
            expense_account_id: form.expense_account_id || null,
            ...(record ? { version: record.version } : {}),
          },
          company: activeCompany(),
        })
      }}
    >
      <Panel>
        <div className="grid gap-4 sm:grid-cols-2">
          <AccountField
            name="from_account_id"
            value={form.from_account_id}
            onChange={(v) => set('from_account_id', v)}
            accounts={accounts.data?.data ?? []}
          />
          <AccountField
            name="to_account_id"
            value={form.to_account_id}
            onChange={(v) => set('to_account_id', v)}
            accounts={(accounts.data?.data ?? []).filter((a) => a.id !== form.from_account_id)}
          />
          <DateField
            name="document_date"
            value={form.document_date}
            onChange={(v) => set('document_date', v)}
          />
          <MoneyField name="amount" value={form.amount} onChange={(v) => set('amount', v)} />
          <MoneyField
            name="target_amount"
            value={form.target_amount}
            onChange={(v) => set('target_amount', v)}
          />
          <MoneyField
            name="source_fx_rate"
            value={form.source_fx_rate}
            onChange={(v) => set('source_fx_rate', v)}
            scale={6}
          />
          <MoneyField
            name="target_fx_rate"
            value={form.target_fx_rate}
            onChange={(v) => set('target_fx_rate', v)}
            scale={6}
          />
          <MoneyField
            name="fee_amount"
            value={form.fee_amount}
            onChange={(v) => set('fee_amount', v)}
            required={false}
          />
          <LedgerField
            name="expense_account_id"
            value={form.expense_account_id}
            onChange={(v) => set('expense_account_id', v)}
          />
        </div>
      </Panel>
      <ErrorNotice error={accounts.error ?? mutation.error} />
      <FormButtons
        pending={mutation.isPending}
        onCancel={onCancel ?? (() => void navigate('/treasury/transfers'))}
      />
    </form>
  )
}
