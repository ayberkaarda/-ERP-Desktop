import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { useId, type KeyboardEvent, type ReactNode } from 'react'
import { Controller, useForm, useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Combobox, Form, FormErrorSummary, FormField, MoneyInput } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useIntlLocale } from '@/lib/datetime'
import { translateMessage } from '@/lib/forms/translate'
import { cn } from '@/lib/utils'
import { useDuplicateCheck } from '../hooks/useParties'
import { countryOptions, currencyOptions } from '../lib/options'
import { taxNumberKind } from '../lib/taxNumber'
import { partyFormSchema, type PartyFormValues } from '../schemas/party'
import { PARTY_ROLES, PARTY_TYPES } from '../types'
import { DuplicateWarning } from './DuplicateWarning'

export interface PartyFormProps {
  defaultValues: PartyFormValues
  /** `quick` shows only identity and tax fields (dialogs). */
  variant?: 'full' | 'quick'
  /** The party being edited, left out of duplicate hits. */
  excludeId?: string
  submitLabel: string
  submitting?: boolean
  serverError?: unknown
  onSubmit: (values: PartyFormValues) => void
  onCancel?: () => void
  /** Extra content under the buttons (hints). */
  footer?: ReactNode
  className?: string
}

export function PartyForm({
  defaultValues,
  variant = 'full',
  excludeId,
  submitLabel,
  submitting = false,
  serverError,
  onSubmit,
  onCancel,
  footer,
  className,
}: PartyFormProps) {
  const { t } = useTranslation('parties')
  const shortcutId = useId()
  const form = useForm<PartyFormValues>({
    resolver: zodResolver(partyFormSchema),
    defaultValues,
    mode: 'onTouched',
  })
  const labels = Object.fromEntries(
    Object.keys(defaultValues).map((k) => [k, t(`fields.${k as keyof PartyFormValues}`)]),
  )

  // Ctrl/Cmd+Enter saves from any field; Escape is left to dialogs and comboboxes.
  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      e.currentTarget.requestSubmit()
    }
  }

  const quick = variant === 'quick'
  return (
    <Form
      form={form}
      onSubmit={onSubmit}
      onKeyDown={onKeyDown}
      aria-describedby={shortcutId}
      className={cn('space-y-6', className)}
    >
      <FormErrorSummary error={serverError ?? null} fieldLabels={labels} />
      <Section title={quick ? undefined : t('form.identity')}>
        <FormField<PartyFormValues, 'name'>
          name="name"
          label={labels.name ?? ''}
          required
          className="sm:col-span-2"
          render={({ field, control }) => (
            <Input {...control} {...field} autoFocus autoComplete="organization" />
          )}
        />
        {!quick && (
          <FormField<PartyFormValues, 'legal_name'>
            name="legal_name"
            label={labels.legal_name ?? ''}
            className="sm:col-span-2"
            render={({ field, control }) => <Input {...control} {...field} />}
          />
        )}
        <TypeField />
        <RolesField />
      </Section>
      <Section title={quick ? undefined : t('form.tax')}>
        <CountryField />
        <TaxNumberField />
        <FormField<PartyFormValues, 'tax_office'>
          name="tax_office"
          label={labels.tax_office ?? ''}
          render={({ field, control }) => <Input {...control} {...field} />}
        />
        <DuplicateHint excludeId={excludeId} />
      </Section>
      {!quick && <CommercialSection />}
      {!quick && (
        <Section title={t('form.other')}>
          <FormField<PartyFormValues, 'tags'>
            name="tags"
            label={labels.tags ?? ''}
            description={t('hints.tags')}
            className="sm:col-span-2"
            render={({ field, control }) => <Input {...control} {...field} />}
          />
          <FormField<PartyFormValues, 'notes'>
            name="notes"
            label={labels.notes ?? ''}
            className="sm:col-span-2"
            render={({ field, control }) => <Textarea {...control} {...field} rows={3} />}
          />
          <ActiveField />
        </Section>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="animate-spin" aria-hidden="true" />}
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t('form.cancel')}
          </Button>
        )}
        <p id={shortcutId} className="text-xs text-muted-foreground">
          {t('hints.shortcut')}
        </p>
      </div>
      {footer}
    </Form>
  )
}

function Section({ title, children }: { title?: string; children: ReactNode }) {
  if (!title) return <div className="grid gap-4 sm:grid-cols-2">{children}</div>
  return (
    <fieldset className="grid gap-4 sm:grid-cols-2">
      <legend className="mb-3 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  )
}

function GroupError({ id, message }: { id: string; message?: string }) {
  const { i18n } = useTranslation('parties')
  const text = translateMessage(i18n, message)
  return text ? (
    <p id={id} className="text-xs text-danger">
      {text}
    </p>
  ) : null
}

function TypeField() {
  const { t } = useTranslation('parties')
  const { control, trigger, getFieldState } = useFormContext<PartyFormValues>()
  return (
    <Controller
      control={control}
      name="type"
      render={({ field }) => (
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">{t('fields.type')}</legend>
          <div className="flex flex-wrap gap-4 pt-1">
            {PARTY_TYPES.map((type) => (
              <label key={type} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={field.name}
                  value={type}
                  checked={field.value === type}
                  onChange={() => {
                    field.onChange(type)
                    if (getFieldState('tax_number').isTouched) void trigger('tax_number')
                  }}
                  onBlur={field.onBlur}
                  className="size-4 accent-primary"
                />
                {t(`types.${type}`)}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    />
  )
}

function RolesField() {
  const { t } = useTranslation('parties')
  const errorId = useId()
  const { control } = useFormContext<PartyFormValues>()
  return (
    <Controller
      control={control}
      name="roles"
      render={({ field, fieldState }) => (
        <fieldset
          className="space-y-1.5"
          aria-invalid={fieldState.error ? true : undefined}
          aria-describedby={fieldState.error ? errorId : undefined}
        >
          <legend className="text-sm font-medium">
            {t('fields.roles')}
            <span className="ml-0.5 text-danger" aria-hidden="true">
              *
            </span>
          </legend>
          <div className="flex flex-wrap gap-4 pt-1">
            {PARTY_ROLES.map((role, i) => (
              <label key={role} className="inline-flex items-center gap-2 text-sm">
                <Checkbox
                  ref={i === 0 ? field.ref : undefined}
                  checked={field.value.includes(role)}
                  onChange={(e) =>
                    field.onChange(
                      e.target.checked
                        ? PARTY_ROLES.filter((r) => r === role || field.value.includes(r))
                        : field.value.filter((r) => r !== role),
                    )
                  }
                  onBlur={field.onBlur}
                />
                {t(`roles.${role}`)}
              </label>
            ))}
          </div>
          <GroupError id={errorId} message={fieldState.error?.message} />
        </fieldset>
      )}
    />
  )
}

function CountryField() {
  const { t } = useTranslation('parties')
  const locale = useIntlLocale()
  const { trigger, getFieldState } = useFormContext<PartyFormValues>()
  return (
    <FormField<PartyFormValues, 'country'>
      name="country"
      label={t('fields.country')}
      required
      render={({ field, control }) => (
        <Combobox
          {...control}
          ref={field.ref}
          value={field.value || null}
          onChange={(v) => {
            field.onChange(v ?? '')
            // The tax number rule depends on the country; re-check what is already typed.
            if (getFieldState('tax_number').isTouched) void trigger('tax_number')
          }}
          onBlur={field.onBlur}
          options={countryOptions(locale)}
        />
      )}
    />
  )
}

function TaxNumberField() {
  const { t } = useTranslation('parties')
  const { control: formControl } = useFormContext<PartyFormValues>()
  const [country, type] = useWatch({ control: formControl, name: ['country', 'type'] })
  const kind = taxNumberKind(country, type)
  return (
    <FormField<PartyFormValues, 'tax_number'>
      name="tax_number"
      label={t('fields.tax_number')}
      description={t(`hints.${kind}`)}
      render={({ field, control }) => (
        <Input
          {...control}
          {...field}
          className="font-code"
          inputMode={kind === 'foreign' ? 'text' : 'numeric'}
          maxLength={kind === 'vkn' ? 10 : kind === 'tckn' ? 11 : 32}
          autoComplete="off"
        />
      )}
    />
  )
}

function DuplicateHint({ excludeId }: { excludeId?: string }) {
  const { control } = useFormContext<PartyFormValues>()
  const [taxNumber, name, country] = useWatch({
    control,
    name: ['tax_number', 'name', 'country'],
  })
  const { matches } = useDuplicateCheck(taxNumber, name, excludeId, country)
  return (
    <div className="sm:col-span-2">
      <DuplicateWarning matches={matches} />
    </div>
  )
}

function CommercialSection() {
  const { t } = useTranslation('parties')
  const locale = useIntlLocale()
  const { control: formControl } = useFormContext<PartyFormValues>()
  const [currency, riskCurrency] = useWatch({
    control: formControl,
    name: ['default_currency_code', 'risk_currency_code'],
  })
  return (
    <Section title={t('form.commercial')}>
      <FormField<PartyFormValues, 'default_currency_code'>
        name="default_currency_code"
        label={t('fields.default_currency_code')}
        render={({ field, control }) => (
          <Combobox
            {...control}
            ref={field.ref}
            value={field.value || null}
            onChange={(v) => field.onChange(v ?? '')}
            onBlur={field.onBlur}
            options={currencyOptions(locale, currency)}
            clearable
          />
        )}
      />
      <div className="hidden sm:block" />
      <FormField<PartyFormValues, 'risk_limit'>
        name="risk_limit"
        label={t('fields.risk_limit')}
        render={({ field, control }) => (
          <MoneyInput
            {...control}
            ref={field.ref}
            currency={riskCurrency || 'TRY'}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
          />
        )}
      />
      <FormField<PartyFormValues, 'risk_currency_code'>
        name="risk_currency_code"
        label={t('fields.risk_currency_code')}
        render={({ field, control }) => (
          <Combobox
            {...control}
            ref={field.ref}
            value={field.value || null}
            onChange={(v) => field.onChange(v ?? '')}
            onBlur={field.onBlur}
            options={currencyOptions(locale, riskCurrency)}
            clearable
          />
        )}
      />
    </Section>
  )
}

function ActiveField() {
  const { t } = useTranslation('parties')
  const { control } = useFormContext<PartyFormValues>()
  return (
    <Controller
      control={control}
      name="is_active"
      render={({ field }) => (
        <label className="inline-flex items-center gap-2 text-sm sm:col-span-2">
          <Checkbox
            ref={field.ref}
            checked={field.value}
            onChange={(e) => field.onChange(e.target.checked)}
            onBlur={field.onBlur}
          />
          {t('fields.is_active')}
        </label>
      )}
    />
  )
}
