import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { FieldShell } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { stableStringify } from '@/features/sales/shared/lib/idempotency'
import { treasuryApi } from '../shared/api'
import { activeCompany } from '../shared/keys'
import type { Statement, StatementInput } from '../shared/types'
import {
  AccountField,
  Amount,
  EnumField,
  ErrorNotice,
  MoneyField,
  Panel,
  SelectField,
  TextField,
} from '../shared/ui'
import { useAccounts, useFormValue, useTreasuryMutation, useTreasuryT } from '../shared/hooks'

type ImportForm = Required<
  Pick<
    StatementInput,
    | 'account_id'
    | 'format'
    | 'content'
    | 'opening_balance'
    | 'closing_balance'
    | 'bank_reference'
    | 'delimiter'
    | 'decimal_separator'
  >
>
export function StatementImport() {
  const t = useTreasuryT()
  const navigate = useNavigate()
  const accounts = useAccounts()
  const [form, set] = useFormValue<ImportForm>({
    account_id: '',
    format: 'csv',
    content: '',
    opening_balance: '0',
    closing_balance: '0',
    bank_reference: '',
    delimiter: 'comma',
    decimal_separator: '.',
  })
  const [mapping, setMapping] = useState({
    date: 'date',
    amount: 'amount',
    reference: 'reference',
    description: 'description',
    value_date: 'value_date',
  })
  const [fileError, setFileError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ key: string; record: Statement } | null>(null)
  const input: StatementInput = {
    ...form,
    currency_code:
      accounts.data?.data.find((a) => a.id === form.account_id)?.currency_code ?? 'TRY',
    ...(form.format === 'csv' ? { mapping } : {}),
  }
  const inputKey = stableStringify(input)
  const previewMutation = useMutation({
    mutationFn: ({ body }: { body: StatementInput; company: string }) =>
      treasuryApi.previewStatement(body),
    onSuccess: (record, { body, company }) => {
      if (company === activeCompany()) setPreview({ key: stableStringify(body), record })
    },
  })
  const mutation = useTreasuryMutation<Statement>(
    'banking:new',
    (body, key) => treasuryApi.create('banking', body, key),
    (r) => void navigate(`/treasury/banking/${r.id}`),
  )
  const current = preview?.key === inputKey ? preview.record : null
  return (
    <div className="space-y-4">
      <Panel>
        <p className="mb-4 text-sm text-muted-foreground">{t('importHelp')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <AccountField
            value={form.account_id}
            onChange={(v) => set('account_id', v)}
            accounts={accounts.data?.data ?? []}
          />
          <EnumField
            name="format"
            value={form.format}
            onChange={(v) => set('format', v as 'csv' | 'mt940')}
            options={['csv', 'mt940']}
          />
          <TextField
            name="bank_reference"
            value={form.bank_reference}
            onChange={(v) => set('bank_reference', v)}
          />
          <FieldShell label={t('file')}>
            {(control) => (
              <Input
                {...control}
                type="file"
                accept=".csv,.sta,.940,.txt"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  setFileError(null)
                  if (!file) return
                  if (file.size > 2 * 1024 * 1024) {
                    setFileError(t('fileTooLarge'))
                    return
                  }
                  void file
                    .text()
                    .then((content) => set('content', content))
                    .catch(() => setFileError(t('error')))
                }}
              />
            )}
          </FieldShell>
          {form.format === 'csv' && (
            <>
              <MoneyField
                name="opening_balance"
                value={form.opening_balance}
                onChange={(v) => set('opening_balance', v)}
              />
              <MoneyField
                name="closing_balance"
                value={form.closing_balance}
                onChange={(v) => set('closing_balance', v)}
              />
              <SelectField
                name="delimiter"
                value={form.delimiter}
                onChange={(v) => set('delimiter', v as 'comma' | 'semicolon' | 'tab')}
                options={[
                  { value: 'comma', label: ',' },
                  { value: 'semicolon', label: ';' },
                  { value: 'tab', label: 'Tab' },
                ]}
              />
              <SelectField
                name="decimal_separator"
                value={form.decimal_separator}
                onChange={(v) => set('decimal_separator', v)}
                options={[
                  { value: '.', label: '.' },
                  { value: ',', label: ',' },
                ]}
              />
            </>
          )}
        </div>
        {form.format === 'csv' && (
          <fieldset className="mt-4 rounded-md border border-border p-4">
            <legend className="px-1 text-sm font-medium">{t('mapping')}</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {(Object.keys(mapping) as (keyof typeof mapping)[]).map((key) => (
                <TextField
                  key={key}
                  name={key}
                  value={mapping[key]}
                  onChange={(v) => setMapping((old) => ({ ...old, [key]: v }))}
                  required={['date', 'amount'].includes(key)}
                />
              ))}
            </div>
          </fieldset>
        )}
        <div className="mt-4">
          <FieldShell label={t('content')} required>
            {(control) => (
              <Textarea
                {...control}
                className="min-h-44 font-code text-xs"
                value={form.content}
                onChange={(e) => set('content', e.target.value)}
                required
              />
            )}
          </FieldShell>
        </div>
        <ErrorNotice
          error={fileError ?? accounts.error ?? previewMutation.error ?? mutation.error}
        />
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            disabled={previewMutation.isPending || !form.account_id || !form.content}
            onClick={() => previewMutation.mutate({ body: input, company: activeCompany() })}
          >
            {previewMutation.isPending ? t('loading') : t('preview')}
          </Button>
          <Button
            disabled={!current || mutation.isPending}
            onClick={() => mutation.mutate({ body: { ...input }, company: activeCompany() })}
          >
            {mutation.isPending ? t('loading') : t('import')}
          </Button>
        </div>
      </Panel>
      {current && (
        <Panel title={t('preview')}>
          <div className="mb-4 flex flex-wrap gap-8 text-sm">
            <p>
              {t('opening_balance')}:{' '}
              <Amount value={current.opening_balance} currency={current.currency_code} />
            </p>
            <p>
              {t('closing_balance')}:{' '}
              <Amount value={current.closing_balance} currency={current.currency_code} />
            </p>
          </div>
          <StatementLines lines={current.lines} currency={current.currency_code} />
        </Panel>
      )}
    </div>
  )
}
export function StatementLines({
  lines,
  currency,
  action,
}: {
  lines: Statement['lines']
  currency: string
  action?: (line: Statement['lines'][number]) => React.ReactNode
}) {
  const t = useTreasuryT()
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            {['date', 'reference', 'description', 'amount', 'status'].map((h) => (
              <th key={h} className="p-2">
                {t(h)}
              </th>
            ))}
            {action && (
              <th className="p-2">
                <span className="sr-only">{t('match')}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i} className="border-b border-border">
              <td className="p-2">{line.date}</td>
              <td className="p-2 font-code">{line.reference}</td>
              <td className="p-2">{line.description}</td>
              <td className="p-2">
                <Amount value={line.amount} currency={currency} />
              </td>
              <td className="p-2">
                {t(line.matched || line.movement_id || line.payment_id ? 'matched' : 'unmatched')}
              </td>
              {action && <td className="p-2">{action(line)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
