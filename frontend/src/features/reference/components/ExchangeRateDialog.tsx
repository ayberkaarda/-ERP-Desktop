import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { FormField } from '@/components/shared/form'
import { toIsoDate } from '@/lib/datetime'
import { useCreateRate } from '../hooks/useReference'
import { useRefT } from '../i18n'
import { exchangeRateSchema, toExchangeRateInput, type ExchangeRateFormValues } from '../schemas'
import { DateField, DecimalField } from './fields'
import { ResourceDialog } from './ResourceDialog'
import { CurrencySelect } from './selects'

interface ExchangeRateDialogProps {
  /** Currency to preselect, e.g. from the row the user came from. */
  currency?: string
  onClose: () => void
}

/** Manual rate entry (source "manual"); rates are decimal strings with up to 6 fraction digits. */
export function ExchangeRateDialog({ currency, onClose }: ExchangeRateDialogProps) {
  const t = useRefT()
  const create = useCreateRate()
  const form = useForm<ExchangeRateFormValues>({
    resolver: zodResolver(exchangeRateSchema),
    defaultValues: {
      currency_code: currency ?? '',
      rate_date: toIsoDate(new Date()),
      forex_buying: '',
      forex_selling: '',
      banknote_buying: '',
      banknote_selling: '',
    },
  })

  return (
    <ResourceDialog
      open
      wide
      onOpenChange={(open) => !open && onClose()}
      title={t('rates.manualTitle')}
      description={t('rates.manualHint')}
      form={form}
      fieldLabels={{
        currency_code: t('rates.currency'),
        rate_date: t('rates.date'),
        forex_buying: t('rates.forexBuying'),
        forex_selling: t('rates.forexSelling'),
        banknote_buying: t('rates.banknoteBuying'),
        banknote_selling: t('rates.banknoteSelling'),
      }}
      onSubmit={async (values, { idempotencyKey }) => {
        await create.mutateAsync({ input: toExchangeRateInput(values), key: idempotencyKey })
      }}
    >
      <FormField<ExchangeRateFormValues, 'currency_code'>
        name="currency_code"
        label={t('rates.currency')}
        required
        render={({ field, control }) => (
          <CurrencySelect
            {...control}
            value={field.value || null}
            onChange={(value) => field.onChange(value ?? '')}
            onBlur={field.onBlur}
          />
        )}
      />
      <DateField<ExchangeRateFormValues> name="rate_date" label={t('rates.date')} required />
      <DecimalField<ExchangeRateFormValues>
        name="forex_buying"
        label={t('rates.forexBuying')}
        required
        scale={6}
        displayMinFraction={4}
      />
      <DecimalField<ExchangeRateFormValues>
        name="forex_selling"
        label={t('rates.forexSelling')}
        required
        scale={6}
        displayMinFraction={4}
      />
      <DecimalField<ExchangeRateFormValues>
        name="banknote_buying"
        label={t('rates.banknoteBuying')}
        scale={6}
        displayMinFraction={4}
      />
      <DecimalField<ExchangeRateFormValues>
        name="banknote_selling"
        label={t('rates.banknoteSelling')}
        scale={6}
        displayMinFraction={4}
      />
    </ResourceDialog>
  )
}
