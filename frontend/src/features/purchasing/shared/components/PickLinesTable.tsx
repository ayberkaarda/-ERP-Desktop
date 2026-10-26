import type Decimal from 'decimal.js'
import { useTranslation } from 'react-i18next'
import { MoneyInput, QuantityInput } from '@/components/shared/form'
import { useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'
import type { QuantityProblem } from '../lib/lifecycle'
import { TABLE } from '../lib/ui'

export interface PickRow {
  id: string
  name: string
  unit: string
  /** What the source holds (requested / ordered quantity). */
  total: string
  /** Upper bound of the quantity. */
  bound: Decimal
}

interface PickLinesTableProps {
  label: string
  rows: PickRow[]
  quantities: Record<string, string>
  onQuantity: (id: string, value: string) => void
  problems: Record<string, QuantityProblem>
  /** Server messages per row id (lines.N.* mapped back). */
  errors?: Record<string, string>
  touched: boolean
  /** Optional price column (request -> order). */
  prices?: Record<string, string>
  onPrice?: (id: string, value: string) => void
  currency?: string
}

/** Quantities (and prices) per source line for a conversion, bounded by what is still open. */
export function PickLinesTable({
  label,
  rows,
  quantities,
  onQuantity,
  problems,
  errors = {},
  touched,
  prices,
  onPrice,
  currency,
}: PickLinesTableProps) {
  const { t } = useTranslation('purchasing-orders')
  const locale = useIntlLocale()
  const qty = (v: string) => formatDecimalDisplay(v, { locale, minFraction: 0, maxFraction: 6 })
  const { th, thr, td, tdr } = TABLE
  return (
    <div className="max-h-[45vh] overflow-auto rounded-md border border-border">
      <table aria-label={label} className="w-full border-separate border-spacing-0">
        <thead className="sticky top-0 bg-surface-sunken text-muted-foreground">
          <tr>
            <th scope="col" className={th}>
              {t('lines.item')}
            </th>
            <th scope="col" className={thr}>
              {t('lines.quantity')}
            </th>
            <th scope="col" className={thr}>
              {t('wizard.remaining')}
            </th>
            <th scope="col" className={`${thr} w-36`}>
              {t('convert.quantity')}
            </th>
            {prices && (
              <th scope="col" className={`${thr} w-40`}>
                {t('lines.unitPrice')}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const problem = problems[r.id]
            const error =
              errors[r.id] ??
              (problem === 'exceeds'
                ? t('wizard.exceeds', { max: qty(r.bound.toString()) })
                : touched && problem
                  ? t('wizard.invalid')
                  : undefined)
            const id = `pick-${r.id}`
            return (
              <tr key={r.id}>
                <td className={td}>{r.name}</td>
                <td className={tdr}>
                  {qty(r.total)} {r.unit}
                </td>
                <td className={tdr}>{qty(r.bound.toString())}</td>
                <td className={tdr}>
                  <QuantityInput
                    id={id}
                    aria-label={t('wizard.quantityFor', { item: r.name })}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${id}-error` : undefined}
                    scale={6}
                    value={quantities[r.id] ?? ''}
                    disabled={r.bound.isZero() && !(quantities[r.id] ?? '')}
                    className="h-control-sm text-right"
                    onChange={(v) => onQuantity(r.id, v)}
                  />
                  {error && (
                    <p id={`${id}-error`} className="pt-0.5 text-left text-2xs text-danger">
                      {error}
                    </p>
                  )}
                </td>
                {prices && (
                  <td className={tdr}>
                    <MoneyInput
                      aria-label={t('convert.priceFor', { item: r.name })}
                      scale={6}
                      displayMinFraction={2}
                      currency={currency}
                      value={prices[r.id] ?? ''}
                      className="h-control-sm text-right"
                      onChange={(v) => onPrice?.(r.id, v)}
                    />
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
