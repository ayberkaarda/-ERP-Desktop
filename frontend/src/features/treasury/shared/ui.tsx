import { useTreasuryT } from './hooks'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { DateInput, DecimalInput, FieldShell } from '@/components/shared/form'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { AccountCombobox } from '@/features/accounting/shared/AccountCombobox'
import { PartyCombobox } from '@/features/parties'
import { money } from '@/features/sales/invoices/kit/money'
import { useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'
import { isApiError } from '@/platform'
import type { Account, Area } from './types'
export function ErrorNotice({ error, reload }: { error: unknown; reload?: () => void }) {
  const t = useTreasuryT()
  if (!error) return null
  return (
    <div
      role="alert"
      className="rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger-soft-foreground"
    >
      <p>
        {isApiError(error) && error.status === 409
          ? t('conflict')
          : error instanceof Error
            ? error.message
            : t('error')}
      </p>
      {isApiError(error) && Object.entries(error.fields).length > 0 && (
        <ul className="mt-2 list-disc pl-4">
          {Object.entries(error.fields).flatMap(([field, messages]) =>
            messages.map((message, i) => (
              <li key={`${field}-${i}`}>
                {t(field.replace(/_id$/, '_id'))}: {message}
              </li>
            )),
          )}
        </ul>
      )}
      {reload && (
        <Button variant="secondary" size="sm" onClick={reload} className="mt-2">
          {t('reload')}
        </Button>
      )}
    </div>
  )
}
export function Loading() {
  return <Skeleton className="h-64 w-full" />
}
export function Status({ value }: { value: string | undefined }) {
  const t = useTreasuryT()
  return value ? (
    <Badge
      tone={
        ['posted', 'cleared', 'reconciled', 'fulfilled', 'approved'].includes(value)
          ? 'success'
          : ['reversed', 'dishonoured'].includes(value)
            ? 'danger'
            : 'neutral'
      }
    >
      {t(value)}
    </Badge>
  ) : null
}
export function Amount({ value, currency }: { value: string | undefined; currency?: string }) {
  const locale = useIntlLocale()
  return (
    <span className="tabular-nums">
      {currency && /^[A-Z]{3}$/.test(currency)
        ? money(value ?? '0', locale, currency)
        : formatDecimalDisplay(value ?? '0', { locale, minFraction: 2, maxFraction: 4 })}
    </span>
  )
}
export function TreasuryHeader({
  area,
  title,
  children,
}: {
  area: Area | 'reports'
  title?: string
  children?: ReactNode
}) {
  const t = useTreasuryT()
  return (
    <PageHeader
      title={title ?? t(area)}
      breadcrumbs={[
        { label: t('title'), to: '/treasury/accounts' },
        { label: t(area), to: `/treasury/${area}` },
      ]}
      actions={children}
    />
  )
}
export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      {title && <h2 className="mb-4 text-base font-semibold">{title}</h2>}
      {children}
    </section>
  )
}
export function TextField({
  name,
  value,
  onChange,
  required = false,
  disabled = false,
  type = 'text',
}: {
  name: string
  value: string
  onChange: (v: string) => void
  required?: boolean
  disabled?: boolean
  type?: string
}) {
  const t = useTreasuryT()
  return (
    <FieldShell label={t(name)} required={required}>
      {(control) => (
        <Input
          {...control}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          disabled={disabled}
        />
      )}
    </FieldShell>
  )
}
export function MoneyField({
  name,
  value,
  onChange,
  required = true,
  scale = 4,
}: {
  name: string
  value: string
  onChange: (v: string) => void
  required?: boolean
  scale?: number
}) {
  const t = useTreasuryT()
  return (
    <FieldShell label={t(name)} required={required}>
      {(control) => (
        <DecimalInput
          {...control}
          value={value}
          onChange={onChange}
          scale={scale}
          displayMinFraction={2}
          allowNegative={['opening_balance', 'closing_balance'].includes(name)}
          required={required}
        />
      )}
    </FieldShell>
  )
}
export function DateField({
  name,
  value,
  onChange,
}: {
  name: string
  value: string
  onChange: (v: string) => void
}) {
  const t = useTreasuryT()
  return (
    <FieldShell label={t(name)} required>
      {(control) => <DateInput {...control} value={value} onChange={onChange} required />}
    </FieldShell>
  )
}
export function SelectField({
  name,
  value,
  onChange,
  options,
  required = true,
  disabled = false,
}: {
  name: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  required?: boolean
  disabled?: boolean
}) {
  const t = useTreasuryT()
  return (
    <FieldShell label={t(name)} required={required}>
      {(control) => (
        <select
          {...control}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          disabled={disabled}
        >
          <option value="">{t('select')}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  )
}
export function EnumField({
  name,
  value,
  onChange,
  options,
}: {
  name: string
  value: string
  onChange: (v: string) => void
  options: string[]
}) {
  const t = useTreasuryT()
  return (
    <SelectField
      name={name}
      value={value}
      onChange={onChange}
      options={options.map((v) => ({ value: v, label: t(v) }))}
    />
  )
}
export function AccountField({
  name = 'account_id',
  value,
  onChange,
  accounts,
  required = true,
}: {
  name?: string
  value: string
  onChange: (v: string) => void
  accounts: Account[]
  required?: boolean
}) {
  return (
    <SelectField
      name={name}
      value={value}
      onChange={onChange}
      required={required}
      options={accounts
        .filter((a) => a.is_active || a.id === value)
        .map((a) => ({ value: a.id, label: `${a.code} · ${a.name} (${a.currency_code})` }))}
    />
  )
}
export function LedgerField({
  name = 'gl_account_id',
  value,
  onChange,
}: {
  name?: string
  value: string
  onChange: (v: string) => void
}) {
  const t = useTreasuryT()
  return (
    <FieldShell label={t(name)} required>
      {(control) => (
        <AccountCombobox {...control} value={value || null} onChange={(id) => onChange(id ?? '')} />
      )}
    </FieldShell>
  )
}
export function PartyField({
  value,
  name,
  onChange,
}: {
  value: string
  name?: string
  onChange: (v: string) => void
}) {
  const t = useTreasuryT()
  return (
    <FieldShell label={t('party_id')} required>
      {(control) => (
        <PartyCombobox
          {...control}
          value={value || null}
          onChange={(id) => onChange(id ?? '')}
          initialParty={value && name ? { id: value, name, code: '', roles: [] } : null}
        />
      )}
    </FieldShell>
  )
}
export function FormButtons({ pending, onCancel }: { pending: boolean; onCancel: () => void }) {
  const t = useTreasuryT()
  return (
    <div className="flex justify-end gap-2 border-t border-border pt-4">
      <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>
        {t('cancel')}
      </Button>
      <Button type="submit" disabled={pending}>
        {pending ? t('loading') : t('save')}
      </Button>
    </div>
  )
}
export function BackLink({ area }: { area: Area }) {
  const t = useTreasuryT()
  return (
    <Link to={`/treasury/${area}`} className="text-sm text-primary hover:underline">
      {t('back')}
    </Link>
  )
}
