import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { PageHeader } from '@/components/shared/PageHeader'
import { useChartTheme } from '@/components/shared/useChartTheme'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMoney } from '@/lib/money'
import { useActiveCompany } from '@/stores/company'

// Placeholder figures (whole TRY) until the Reporting module exposes dashboard endpoints.
const KPIS = [
  { key: 'revenue', value: '4826450.00', delta: 8.4 },
  { key: 'receivables', value: '1932780.50', delta: -3.1 },
  { key: 'payables', value: '1214305.25', delta: 2.2 },
  { key: 'cash', value: '3075610.75', delta: 5.6 },
] as const

const CASHFLOW = [
  { month: '2026-05', inflow: 3420000, outflow: 2960000 },
  { month: '2026-06', inflow: 3880000, outflow: 3210000 },
  { month: '2026-07', inflow: 3510000, outflow: 3620000 },
  { month: '2026-08', inflow: 4120000, outflow: 3400000 },
  { month: '2026-09', inflow: 4450000, outflow: 3770000 },
  { month: '2026-10', inflow: 4830000, outflow: 3950000 },
]

const DOCUMENTS = [
  { key: 'invoices', count: 1284 },
  { key: 'orders', count: 862 },
  { key: 'waybills', count: 741 },
  { key: 'receipts', count: 455 },
] as const

export function DashboardPage() {
  const { t, i18n } = useTranslation()
  const company = useActiveCompany()
  const c = useChartTheme()
  const locale = i18n.resolvedLanguage ?? 'tr'

  const monthFmt = new Intl.DateTimeFormat(locale, { month: 'short' })
  const millions = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  const cashflow = CASHFLOW.map((d) => ({
    ...d,
    label: monthFmt.format(new Date(`${d.month}-15T00:00:00`)),
  }))
  const documents = DOCUMENTS.map((d) => ({ ...d, label: t(`dashboard.chart.${d.key}`) }))
  const tooltipStyle = {
    background: c['surface-raised'],
    border: `1px solid ${c.border}`,
    borderRadius: 6,
    fontSize: 12,
  }

  return (
    <div className="mx-auto max-w-[1440px] p-6">
      <PageHeader
        title={t('dashboard.title')}
        description={t('dashboard.subtitle', { company: company?.name ?? '' })}
        actions={<Badge tone="warning">{t('dashboard.sampleData')}</Badge>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KPIS.map((kpi) => {
          const up = kpi.delta >= 0
          return (
            <Card key={kpi.key} className="px-5 py-4">
              <p className="text-xs font-medium text-muted-foreground">
                {t(`dashboard.kpi.${kpi.key}`)}
              </p>
              <p className="mt-1.5 text-xl font-semibold tracking-[-0.01em]">
                {formatMoney(kpi.value, company?.currency ?? 'TRY', locale)}
              </p>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Badge tone={up ? 'success' : 'danger'}>
                  {up ? <ArrowUpRight /> : <ArrowDownRight />}
                  {new Intl.NumberFormat(locale, {
                    style: 'percent',
                    maximumFractionDigits: 1,
                    signDisplay: 'always',
                  }).format(kpi.delta / 100)}
                </Badge>
                {t('dashboard.vsLastMonth')}
              </p>
            </Card>
          )
        })}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>{t('dashboard.chart.cashflow')}</CardTitle>
              <CardDescription>{t('dashboard.chart.cashflowHint')}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cashflow} barGap={3} margin={{ left: -12, right: 4, top: 4 }}>
                <CartesianGrid vertical={false} stroke={c['chart-grid']} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: c['muted-foreground'], fontSize: 12 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: c['muted-foreground'], fontSize: 12 }}
                  tickFormatter={(v: number) => `${millions.format(v / 1_000_000)} Mn`}
                />
                <Tooltip
                  cursor={{ fill: c['chart-grid'], opacity: 0.6 }}
                  contentStyle={tooltipStyle}
                  formatter={(v) => formatMoney(String(v), company?.currency ?? 'TRY', locale, 0)}
                />
                <Legend
                  iconType="square"
                  iconSize={10}
                  wrapperStyle={{ fontSize: 12 }}
                  formatter={(value: string) => (
                    <span className="text-muted-foreground">{value}</span>
                  )}
                />
                <Bar
                  dataKey="inflow"
                  name={t('dashboard.chart.inflow')}
                  fill={c['chart-1']}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={28}
                />
                <Bar
                  dataKey="outflow"
                  name={t('dashboard.chart.outflow')}
                  fill={c['chart-2']}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={28}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t('dashboard.chart.byModule')}</CardTitle>
              <CardDescription>{t('dashboard.chart.byModuleHint')}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={documents} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid horizontal={false} stroke={c['chart-grid']} />
                <XAxis
                  type="number"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: c['muted-foreground'], fontSize: 12 }}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={96}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: c['muted-foreground'], fontSize: 12 }}
                />
                <Tooltip
                  cursor={{ fill: c['chart-grid'], opacity: 0.6 }}
                  contentStyle={tooltipStyle}
                />
                <Bar
                  dataKey="count"
                  name={t('dashboard.chart.byModule')}
                  fill={c['chart-1']}
                  radius={[0, 3, 3, 0]}
                  maxBarSize={22}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
