import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toIsoDate } from '@/lib/datetime'
import { Allocations } from '../payments/Allocations'
import { instrumentAllocationInput } from '../payments/lib'
import { treasuryApi } from '../shared/api'
import { activeCompany } from '../shared/keys'
import type { Allocation, Instrument } from '../shared/types'
import {
  DateField,
  EnumField,
  ErrorNotice,
  FormButtons,
  MoneyField,
  Panel,
  PartyField,
  TextField,
} from '../shared/ui'
import { useFormValue, useTreasuryMutation } from '../shared/hooks'

export function InstrumentEditor({
  record,
  onCancel,
  onSaved,
}: {
  record?: Instrument
  onCancel?: () => void
  onSaved?: (record: Instrument) => void
}) {
  const navigate = useNavigate()
  const today = toIsoDate(new Date())
  const [form, set] = useFormValue({
    kind: record?.kind ?? 'cheque',
    direction: record?.direction ?? 'received',
    instrument_number: record?.instrument_number ?? '',
    party_id: record?.party_id ?? '',
    amount: record?.amount ?? '',
    currency_code: record?.currency_code ?? 'TRY',
    fx_rate: record?.fx_rate ?? '1',
    issue_date: record?.issue_date ?? today,
    due_date: record?.due_date ?? today,
    bank_name: record?.bank_name ?? '',
    drawer: record?.drawer ?? '',
    reference: record?.reference ?? '',
  })
  const [allocations, setAllocations] = useState<Allocation[]>(record?.allocations ?? [])
  const mutation = useTreasuryMutation<Instrument>(
    `instruments:${record?.id ?? 'new'}`,
    (body, key) =>
      record
        ? treasuryApi.update('instruments', record.id, body)
        : treasuryApi.create('instruments', body, key),
    (r) => (onSaved ? onSaved(r) : void navigate(`/treasury/instruments/${r.id}`)),
  )
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        mutation.mutate({
          body: {
            ...form,
            allocations: instrumentAllocationInput(allocations),
            ...(record ? { version: record.version } : {}),
          },
          company: activeCompany(),
        })
      }}
    >
      <Panel>
        <div className="grid gap-4 sm:grid-cols-2">
          <EnumField
            name="kind"
            value={form.kind}
            onChange={(v) => set('kind', v as Instrument['kind'])}
            options={['cheque', 'note']}
          />
          <EnumField
            name="direction"
            value={form.direction}
            onChange={(v) => {
              set('direction', v as Instrument['direction'])
              setAllocations([])
            }}
            options={['received', 'issued']}
          />
          <TextField
            name="instrument_number"
            value={form.instrument_number}
            onChange={(v) => set('instrument_number', v)}
            required
          />
          <PartyField
            value={form.party_id}
            name={record?.party_name}
            onChange={(v) => {
              set('party_id', v)
              setAllocations([])
            }}
          />
          <MoneyField name="amount" value={form.amount} onChange={(v) => set('amount', v)} />
          <TextField
            name="currency_code"
            value={form.currency_code}
            onChange={(v) => set('currency_code', v.toUpperCase())}
            required
          />
          <MoneyField
            name="fx_rate"
            value={form.fx_rate}
            onChange={(v) => set('fx_rate', v)}
            scale={6}
          />
          <DateField
            name="issue_date"
            value={form.issue_date}
            onChange={(v) => set('issue_date', v)}
          />
          <DateField name="due_date" value={form.due_date} onChange={(v) => set('due_date', v)} />
          <TextField
            name="bank_name"
            value={form.bank_name}
            onChange={(v) => set('bank_name', v)}
          />
          <TextField name="drawer" value={form.drawer} onChange={(v) => set('drawer', v)} />
          <TextField
            name="reference"
            value={form.reference}
            onChange={(v) => set('reference', v)}
          />
        </div>
      </Panel>
      <Allocations
        partyId={form.party_id}
        direction={form.direction === 'received' ? 'receipt' : 'payment'}
        value={allocations}
        onChange={setAllocations}
        currency={form.currency_code}
        showRate={false}
      />
      <ErrorNotice error={mutation.error} />
      <FormButtons
        pending={mutation.isPending}
        onCancel={onCancel ?? (() => void navigate('/treasury/instruments'))}
      />
    </form>
  )
}
