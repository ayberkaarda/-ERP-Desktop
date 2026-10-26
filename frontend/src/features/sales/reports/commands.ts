import { BarChart3 } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { REPORTS_BASE } from '../invoices/kit/links'
import { REPORTS } from './definitions'

/** Palette entries: the reports hub and each report. */
export function salesReportsCommands(): Command[] {
  return [
    {
      id: 'sales.reports',
      group: 'navigation',
      icon: BarChart3,
      permission: 'sales.reports.view',
      title: (t) => t('hub.title', { ns: 'sales-reports' }),
      keywords: () => ['sales reports', 'satış raporları', 'rapor'],
      run: ({ navigate }) => navigate(REPORTS_BASE),
    },
    ...REPORTS.map((r): Command => ({
      id: `sales.reports.${r.slug}`,
      group: 'navigation',
      icon: BarChart3,
      permission: r.permission,
      title: (t) => t(`report.${r.id}.title`, { ns: 'sales-reports' }),
      keywords: () => ['sales report', 'satış raporu', r.slug],
      run: ({ navigate }) => navigate(`${REPORTS_BASE}/${r.slug}`),
    })),
  ]
}

/** Called once at startup by the shell; returns the unregister function. */
export function registerSalesReportsCommands(): () => void {
  return registerCommands(salesReportsCommands())
}
