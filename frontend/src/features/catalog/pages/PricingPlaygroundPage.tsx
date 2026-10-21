import { zodResolver } from '@hookform/resolvers/zod'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Calculator, CheckCircle2, CircleDashed, CircleMinus, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import {
  DateInput,
  Form,
  FormErrorSummary,
  FormField,
  QuantityInput,
} from '@/components/shared/form'
import { PageHeader } from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toIsoDate, useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'
import { cn } from '@/lib/utils'
import { discountRulesApi, pricingApi, priceListsApi } from '../api/client'
import { catalogKeys } from '../api/keys'
import { selectClass } from '../lib/ui'
import { ItemCombobox } from '../components/ItemCombobox'
import { CurrencySelect, PartyPicker, UnitSelect } from '../components/pickers'
import { useVariants } from '../hooks/queries'
import {
  explainResult,
  lineTotal,
  netUnitPrice,
  PRECEDENCE_STEPS,
  type StepState,
} from '../lib/pricing'
import { playgroundSchema, type PlaygroundValues } from '../schemas'
import type { PricingQuery, PricingResult } from '../types'

const NO_QUERY: PricingQuery = { item_id: '', qty: '', date: '', currency: '' }

function toQuery(v: PlaygroundValues): PricingQuery {
  return {
    item_id: v.item_id,
    variant_id: v.variant_id || undefined,
    party_id: v.party_id || undefined,
    qty: v.qty,
    unit_id: v.unit_id || undefined,
    date: v.date,
    currency: v.currency,
  }
}

export function PricingPlaygroundPage() {
  const { t } = useTranslation('catalog')
  const [submitted, setSubmitted] = useState<PricingQuery | null>(null)
  const form = useForm<PlaygroundValues>({
    resolver: zodResolver(playgroundSchema),
    defaultValues: {
      item_id: '',
      variant_id: '',
      party_id: '',
      qty: '1',
      unit_id: '',
      date: toIsoDate(new Date()),
      // The resolver needs a currency; TRY is the default base currency.
      currency: 'TRY',
    },
  })
  const itemId = useWatch({ control: form.control, name: 'item_id' })
  const variants = useVariants(itemId || undefined)
  const pending = submitted ?? NO_QUERY
  const result = useQuery({
    queryKey: catalogKeys.pricing(pending),
    queryFn: ({ signal }) => pricingApi.resolve(pending, signal),
    enabled: submitted !== null,
    staleTime: 0,
    retry: false,
  })

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <PageHeader
        title={t('pricing.title')}
        description={t('pricing.description')}
        breadcrumbs={[{ label: t('nav.catalog') }, { label: t('pricing.title') }]}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <section
          aria-labelledby="pg-inputs"
          className="rounded-lg border border-border bg-surface p-5"
        >
          <h2 id="pg-inputs" className="mb-4 text-base font-semibold">
            {t('pricing.inputs')}
          </h2>
          <Form
            form={form}
            onSubmit={(v) => {
              const next = toQuery(v)
              if (JSON.stringify(next) === JSON.stringify(submitted)) void result.refetch()
              else setSubmitted(next)
            }}
            className="grid gap-4"
          >
            <FormField<PlaygroundValues, 'item_id'>
              name="item_id"
              label={t('fields.item')}
              required
              render={({ field, control }) => (
                <ItemCombobox
                  {...control}
                  ref={field.ref}
                  value={field.value || null}
                  onBlur={field.onBlur}
                  onChange={(id, item) => {
                    field.onChange(id ?? '')
                    form.setValue('variant_id', '')
                    form.setValue('unit_id', item?.base_unit_id ?? '')
                  }}
                />
              )}
            />
            <FormField<PlaygroundValues, 'variant_id'>
              name="variant_id"
              label={t('fields.variant')}
              render={({ field, control }) => (
                <select
                  {...control}
                  {...field}
                  className={selectClass}
                  disabled={(variants.data ?? []).length === 0}
                >
                  <option value="">{t('priceLines.anyVariant')}</option>
                  {(variants.data ?? []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.sku}
                    </option>
                  ))}
                </select>
              )}
            />
            <FormField<PlaygroundValues, 'party_id'>
              name="party_id"
              label={t('fields.party')}
              description={t('pricing.partyHelp')}
              render={({ field, control }) => (
                <PartyPicker
                  {...control}
                  ref={field.ref}
                  value={field.value || null}
                  onChange={(v) => field.onChange(v ?? '')}
                  onBlur={field.onBlur}
                />
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField<PlaygroundValues, 'qty'>
                name="qty"
                label={t('fields.qty')}
                required
                render={({ field, control }) => (
                  <QuantityInput
                    {...control}
                    ref={field.ref}
                    scale={6}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                  />
                )}
              />
              <FormField<PlaygroundValues, 'unit_id'>
                name="unit_id"
                label={t('fields.unit')}
                render={({ field, control }) => (
                  <UnitSelect
                    {...control}
                    ref={field.ref}
                    value={field.value || null}
                    onChange={(v) => field.onChange(v ?? '')}
                    onBlur={field.onBlur}
                  />
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField<PlaygroundValues, 'date'>
                name="date"
                label={t('fields.date')}
                required
                render={({ field, control }) => (
                  <DateInput
                    {...control}
                    ref={field.ref}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                  />
                )}
              />
              <FormField<PlaygroundValues, 'currency'>
                name="currency"
                label={t('fields.currency')}
                required
                render={({ field, control }) => (
                  <CurrencySelect
                    {...control}
                    ref={field.ref}
                    value={field.value || null}
                    onChange={(v) => field.onChange(v ?? '')}
                    onBlur={field.onBlur}
                  />
                )}
              />
            </div>
            <Button type="submit" disabled={result.isFetching}>
              {result.isFetching ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Calculator aria-hidden="true" />
              )}
              {t('pricing.resolve')}
            </Button>
            {result.isError && (
              <FormErrorSummary error={result.error} title={t('pricing.failed')} />
            )}
          </Form>
        </section>
        <div className="space-y-6">
          {result.data && submitted ? (
            <ResultView result={result.data} query={submitted} />
          ) : (
            <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
              {t('pricing.empty')}
            </p>
          )}
          <PrecedenceView result={result.data ?? null} />
        </div>
      </div>
    </div>
  )
}

function ResultView({ result, query }: { result: PricingResult; query: PricingQuery }) {
  const { t } = useTranslation('catalog')
  const locale = useIntlLocale()
  const fmt = (v: string, min = 2, max = 6) =>
    formatDecimalDisplay(v, { locale, minFraction: min, maxFraction: max })
  const net = result.net_unit_price ?? netUnitPrice(result.unit_price, result.discount_percent)
  const total = lineTotal(net, query.qty)
  const list = useQuery({
    queryKey: catalogKeys.priceList(result.price_list_id ?? ''),
    queryFn: ({ signal }) => priceListsApi.get(result.price_list_id ?? '', signal),
    enabled: Boolean(result.price_list_id),
    retry: false,
  })
  const rules = useQueries({
    queries: (result.discount_rule_ids ?? []).map((id) => ({
      queryKey: [...catalogKeys.discountRules(), 'detail', id],
      queryFn: ({ signal }: { signal: AbortSignal }) => discountRulesApi.get(id, signal),
      retry: false,
    })),
  })

  return (
    <section aria-labelledby="pg-result" className="rounded-lg border border-border bg-surface p-5">
      <h2 id="pg-result" className="mb-4 text-base font-semibold">
        {t('pricing.result')}
      </h2>
      {result.unit_price === null ? (
        <p role="status" className="text-sm text-warning-soft-foreground">
          {t('pricing.noPrice')}
        </p>
      ) : (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2" role="status" aria-live="polite">
          <Stat
            label={t('pricing.unitPrice')}
            value={`${fmt(result.unit_price)} ${result.currency}`}
          />
          <Stat
            label={t('fields.discountPercent')}
            value={`%${fmt(result.discount_percent || '0', 0, 4)}`}
          />
          <Stat
            label={t('pricing.netUnitPrice')}
            value={net ? `${fmt(net)} ${result.currency}` : '—'}
            strong
          />
          <Stat
            label={t('pricing.lineTotal', { qty: fmt(query.qty, 0, 6) })}
            value={total ? `${fmt(total, 2, 2)} ${result.currency}` : '—'}
          />
        </dl>
      )}
      <dl className="mt-4 grid gap-x-6 gap-y-2 border-t border-border pt-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">{t('pricing.source')}</dt>
          <dd>
            {t(
              `pricing.sources.${result.source === 'party_price_list' || result.source === 'default_price_list' ? result.source : 'none'}`,
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('pricing.priceList')}</dt>
          <dd>
            {result.price_list_id ? (
              <Link to={`/catalog/price-lists/${result.price_list_id}`} className="hover:underline">
                {list.data ? `${list.data.code} · ${list.data.name}` : result.price_list_id}
              </Link>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted-foreground">{t('pricing.rules')}</dt>
          <dd className="flex flex-wrap gap-1.5">
            {(result.discount_rule_ids ?? []).length === 0
              ? '—'
              : (result.discount_rule_ids ?? []).map((id, i) => {
                  const r = rules[i]?.data
                  return (
                    <Badge key={id} tone="neutral">
                      {r ? `${r.code} · %${fmt(r.discount_percent, 0, 4)}` : id}
                    </Badge>
                  )
                })}
          </dd>
        </div>
      </dl>
    </section>
  )
}

function Stat({
  label,
  value,
  strong = false,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('tabular-nums', strong ? 'text-xl font-semibold' : 'text-base')}>
        {value}
      </dd>
    </div>
  )
}

const STATE_ICON: Record<StepState, typeof CheckCircle2> = {
  decided: CheckCircle2,
  passed: CircleDashed,
  skipped: CircleMinus,
  none: CircleMinus,
}

function PrecedenceView({ result }: { result: PricingResult | null }) {
  const { t } = useTranslation('catalog')
  const states = result ? explainResult(result) : null
  return (
    <section
      aria-labelledby="pg-precedence"
      className="rounded-lg border border-border bg-surface p-5"
    >
      <h2 id="pg-precedence" className="text-base font-semibold">
        {t('pricing.precedence')}
      </h2>
      <p className="mb-4 text-xs text-muted-foreground">{t('pricing.precedenceHelp')}</p>
      <ol className="space-y-3">
        {PRECEDENCE_STEPS.map((step, i) => {
          const state = states?.[step]
          const Icon = state ? STATE_ICON[state] : CircleDashed
          return (
            <li key={step} className="flex gap-3">
              <span
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold',
                  state === 'decided'
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground',
                )}
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <div className="min-w-0 space-y-0.5">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {t(`pricing.steps.${step}.title`)}
                  {state && (
                    <Badge tone={state === 'decided' ? 'primary' : 'neutral'}>
                      <Icon className="size-3" aria-hidden="true" />
                      {t(`pricing.state.${state}`)}
                    </Badge>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{t(`pricing.steps.${step}.body`)}</p>
              </div>
            </li>
          )
        })}
      </ol>
      {result?.trace && result.trace.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="mb-2 text-sm font-semibold">{t('pricing.trace')}</h3>
          <ol className="list-decimal space-y-1 pl-5 text-xs">
            {result.trace.map((s, i) => (
              <li key={`${s.step}-${i}`}>
                <span className="font-code">{s.step}</span> —{' '}
                {t(`pricing.traceOutcome.${s.outcome}`)}
                {s.detail ? `: ${s.detail}` : ''}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}
