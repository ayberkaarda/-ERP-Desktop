import { useTranslation } from 'react-i18next'
import { useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { ChartDef, ColLabel, Row } from '../definitions'
import { chartBars, stackedSegments } from '../lib/chart'

interface ReportChartProps {
  def: ChartDef
  rows: Row[]
  totals: Row | null
  title: string
  /** Column label key per value field (legend of stacked charts). */
  labels: Record<string, ColLabel>
}

const SEGMENT = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5', 'bg-chart-6']

/** Plain SVG/CSS charts (DESIGN.md): period columns, top-N bars and ageing buckets. */
export function ReportChart({ def, rows, totals, title, labels }: ReportChartProps) {
  const { t } = useTranslation('sales-reports')
  const locale = useIntlLocale()
  const fmt = (v: string) =>
    def.percent
      ? `%${formatDecimalDisplay(v, { locale, minFraction: 0, maxFraction: 1 })}`
      : formatDecimalDisplay(v, { locale, minFraction: 0, maxFraction: 0 })

  if (def.kind === 'stacked') {
    const segments = stackedSegments(def, totals, rows)
    if (segments.every((s) => s.share === 0)) return null
    return (
      <figure
        className="space-y-2 rounded-lg border border-border bg-surface p-4"
        data-testid="report-chart"
      >
        <figcaption className="text-xs font-medium text-muted-foreground">{title}</figcaption>
        <div className="flex h-6 w-full overflow-hidden rounded-sm" role="img" aria-label={title}>
          {segments.map((s, i) => (
            <div
              key={s.key}
              className={cn('h-full transition-[width] duration-300', SEGMENT[i % SEGMENT.length])}
              style={{ width: `${(s.share * 100).toFixed(2)}%` }}
            />
          ))}
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {segments.map((s, i) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span
                className={cn('size-2.5 rounded-xs', SEGMENT[i % SEGMENT.length])}
                aria-hidden="true"
              />
              <span>{t(`col.${labels[s.key] ?? 'total'}`)}</span>
              <span className="text-muted-foreground tabular-nums">
                {formatDecimalDisplay(s.value, { locale })} · %{(s.share * 100).toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
      </figure>
    )
  }

  const { bars, ticks, max } = chartBars(def, rows)
  if (bars.length === 0) return null

  if (def.kind === 'bar') {
    return (
      <figure
        className="space-y-2 rounded-lg border border-border bg-surface p-4"
        data-testid="report-chart"
      >
        <figcaption className="text-xs font-medium text-muted-foreground">{title}</figcaption>
        <ul className="space-y-1.5" aria-label={title}>
          {bars.map((b, i) => (
            <li
              key={`${b.label}-${i}`}
              className="grid grid-cols-[minmax(6rem,14rem)_1fr_auto] items-center gap-2 text-xs"
            >
              <span className="truncate" title={b.label}>
                {b.label}
              </span>
              <span className="h-3 rounded-xs bg-chart-grid">
                <span
                  className={cn(
                    'block h-full rounded-xs transition-[width] duration-300',
                    b.negative ? 'bg-danger' : 'bg-chart-1',
                  )}
                  style={{ width: `${(b.ratio * 100).toFixed(2)}%` }}
                />
              </span>
              <span className="text-right tabular-nums">{fmt(b.value)}</span>
            </li>
          ))}
        </ul>
      </figure>
    )
  }

  // Column chart: SVG in a fixed viewBox; colors through CSS classes (attributes cannot read var()).
  const W = 640
  const H = 200
  const left = 56
  const bottom = 24
  const plotW = W - left - 8
  const plotH = H - bottom - 8
  const slot = plotW / bars.length
  const barW = Math.max(2, Math.min(40, slot * 0.6))
  return (
    <figure
      className="space-y-2 rounded-lg border border-border bg-surface p-4"
      data-testid="report-chart"
    >
      <figcaption className="text-xs font-medium text-muted-foreground">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-52 w-full" role="img" aria-label={title}>
        {ticks.map((tick) => {
          const y = 8 + plotH - (max.isZero() ? 0 : tick.div(max).toNumber()) * plotH
          return (
            <g key={tick.toString()}>
              <line
                x1={left}
                x2={W - 8}
                y1={y}
                y2={y}
                className="stroke-chart-grid"
                strokeWidth={1}
              />
              <text
                x={left - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-muted-foreground text-[10px]"
              >
                {fmt(tick.toString())}
              </text>
            </g>
          )
        })}
        {bars.map((b, i) => {
          const h = b.ratio * plotH
          const x = left + i * slot + (slot - barW) / 2
          return (
            <g key={`${b.label}-${i}`}>
              <rect
                x={x}
                y={8 + plotH - h}
                width={barW}
                height={h}
                rx={2}
                className={b.negative ? 'fill-danger' : 'fill-chart-1'}
              >
                <title>{`${b.label}: ${fmt(b.value)}`}</title>
              </rect>
              {(bars.length <= 12 || i % Math.ceil(bars.length / 12) === 0) && (
                <text
                  x={x + barW / 2}
                  y={H - 8}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px]"
                >
                  {b.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </figure>
  )
}
