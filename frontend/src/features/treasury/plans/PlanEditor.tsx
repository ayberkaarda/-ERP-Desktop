import { useNavigate } from 'react-router'
import { toIsoDate } from '@/lib/datetime'
import { treasuryApi } from '../shared/api'
import { activeCompany } from '../shared/keys'
import type { Direction, Plan } from '../shared/types'
import {
  AccountField,
  DateField,
  EnumField,
  ErrorNotice,
  FormButtons,
  MoneyField,
  Panel,
  PartyField,
  TextField,
} from '../shared/ui'
import { useAccounts, useFormValue, useTreasuryMutation, useTreasuryT } from '../shared/hooks'

export function PlanEditor({
  record,
  onCancel,
  onSaved,
}: {
  record?: Plan
  onCancel?: () => void
  onSaved?: (record: Plan) => void
}) {
  const navigate = useNavigate()
  const accounts = useAccounts()
  const t = useTreasuryT()
  const [form, set] = useFormValue({
    party_id: record?.party_id ?? '',
    direction: record?.direction ?? 'payment',
    currency_code: record?.currency_code ?? 'TRY',
    amount: record?.amount ?? '',
    due_date: record?.due_date ?? toIsoDate(new Date()),
    description: record?.description ?? '',
    account_id: record?.account_id ?? '',
  })
  const mutation = useTreasuryMutation<Plan>(
    `plans:${record?.id ?? 'new'}`,
    (body, key) =>
      record
        ? treasuryApi.update('plans', record.id, body)
        : treasuryApi.create('plans', body, key),
    (r) => (onSaved ? onSaved(r) : void navigate(`/treasury/plans/${r.id}`)),
  )
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        mutation.mutate({
          body: {
            ...form,
            account_id: form.account_id || null,
            ...(record ? { version: record.version } : {}),
          },
          company: activeCompany(),
        })
      }}
    >
      <Panel>
        <div className="grid gap-4 sm:grid-cols-2">
          <PartyField value={form.party_id} onChange={(v) => set('party_id', v)} />
          <EnumField
            name="direction"
            value={form.direction}
            onChange={(v) => set('direction', v as Direction)}
            options={['receipt', 'payment']}
          />
          <TextField
            name="currency_code"
            value={form.currency_code}
            onChange={(v) => set('currency_code', v.toUpperCase())}
            required
          />
          <MoneyField name="amount" value={form.amount} onChange={(v) => set('amount', v)} />
          <DateField name="due_date" value={form.due_date} onChange={(v) => set('due_date', v)} />
          <AccountField
            value={form.account_id}
            onChange={(v) => set('account_id', v)}
            accounts={(accounts.data?.data ?? []).filter(
              (a) => a.currency_code === form.currency_code,
            )}
            required={false}
          />
          <TextField
            name="description"
            value={form.description}
            onChange={(v) => set('description', v)}
          />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">{t('noAutomaticBank')}</p>
      </Panel>
      <ErrorNotice error={accounts.error ?? mutation.error} />
      <FormButtons
        pending={mutation.isPending}
        onCancel={onCancel ?? (() => void navigate('/treasury/plans'))}
      />
    </form>
  )
}
