import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toIsoDate } from '@/lib/datetime'
import { activeCompany } from '../shared/keys'
import { treasuryApi } from '../shared/api'
import type { Allocation, Direction, Payment } from '../shared/types'
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
  SelectField,
} from '../shared/ui'
import { useAccounts, useFormValue, useTreasuryMutation, useTreasuryT } from '../shared/hooks'
import { Allocations } from './Allocations'
import { paymentAllocationInput } from './lib'

export function PaymentEditor({
  record,
  onCancel,
  onSaved,
}: {
  record?: Payment
  onCancel?: () => void
  onSaved?: (record: Payment) => void
}) {
  const navigate = useNavigate()
  const t = useTreasuryT()
  const accounts = useAccounts()
  const [form, set] = useFormValue({
    direction: record?.direction ?? 'receipt',
    counterparty_module: record?.counterparty_module ?? '',
    account_id: record?.account_id ?? '',
    party_id: record?.party_id ?? '',
    document_date: record?.document_date ?? toIsoDate(new Date()),
    fx_rate: record?.fx_rate ?? '1',
    amount: record?.amount ?? '',
    reference: record?.reference ?? '',
    description: record?.description ?? '',
  })
  const [allocations, setAllocations] = useState<Allocation[]>(record?.allocations ?? [])
  const currency =
    accounts.data?.data.find((a) => a.id === form.account_id)?.currency_code ??
    record?.currency_code ??
    'TRY'
  const mutation = useTreasuryMutation<Payment>(
    `payments:${record?.id ?? 'new'}`,
    (body, key) =>
      record
        ? treasuryApi.update('payments', record.id, body)
        : treasuryApi.create('payments', body, key),
    (result) => (onSaved ? onSaved(result) : void navigate(`/treasury/payments/${result.id}`)),
  )
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        mutation.mutate({
          body: {
            ...form,
            counterparty_module: form.counterparty_module || (record ? null : undefined),
            currency_code: currency,
            allocations: paymentAllocationInput(allocations),
            ...(record ? { version: record.version } : {}),
          },
          company: activeCompany(),
        })
      }}
    >
      <Panel>
        <div className="grid gap-4 sm:grid-cols-2">
          <EnumField
            name="direction"
            value={form.direction}
            onChange={(v) => {
              set('direction', v as Direction)
              setAllocations([])
            }}
            options={['receipt', 'payment']}
          />
          <AccountField
            value={form.account_id}
            onChange={(v) => {
              set('account_id', v)
              setAllocations([])
            }}
            accounts={accounts.data?.data ?? []}
          />
          <SelectField
            name="counterparty_module"
            value={form.counterparty_module}
            onChange={(v) => set('counterparty_module', v as '' | 'sales' | 'purchasing')}
            options={['sales', 'purchasing'].map((value) => ({ value, label: t(value) }))}
            required={false}
          />
          <PartyField
            value={form.party_id}
            name={record?.party_name}
            onChange={(v) => {
              set('party_id', v)
              setAllocations([])
            }}
          />
          <DateField
            name="document_date"
            value={form.document_date}
            onChange={(v) => set('document_date', v)}
          />
          <MoneyField name="amount" value={form.amount} onChange={(v) => set('amount', v)} />
          <MoneyField
            name="fx_rate"
            value={form.fx_rate}
            onChange={(v) => {
              set('fx_rate', v)
              setAllocations((lines) =>
                lines.map((line) =>
                  line.currency_code === currency ? { ...line, fx_rate: v } : line,
                ),
              )
            }}
            scale={6}
          />
          <TextField
            name="reference"
            value={form.reference}
            onChange={(v) => set('reference', v)}
          />
          <TextField
            name="description"
            value={form.description}
            onChange={(v) => set('description', v)}
          />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          {t('currency_code')}: {currency} · {t('noAutomaticBank')}
        </p>
      </Panel>
      <ErrorNotice error={accounts.error} />
      <Allocations
        partyId={form.party_id}
        direction={form.direction}
        value={allocations}
        onChange={setAllocations}
        currency={currency}
        fxRate={form.fx_rate}
      />
      <ErrorNotice error={mutation.error} />
      <FormButtons
        pending={mutation.isPending}
        onCancel={onCancel ?? (() => void navigate('/treasury/payments'))}
      />
    </form>
  )
}
