import { BarChart3 } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { REPORTS_BASE } from '../invoices/kit/links'
import { PURCH_OPEN } from '../invoices/kit/permissions'
import { REPORTS } from './definitions'

/** Palette entries: the reports hub and each report (hidden without purchasing.reports.view). */
export function purchaseReportsCommands(): Command[] {
  return [
    {
      id: 'purchasing.reports',
      group: 'navigation',
      icon: BarChart3,
      permission: PURCH_OPEN.reports,
      title: (t) => t('hub.title', { ns: 'purchasing-reports' }),
      keywords: () => ['purchasing reports', 'satın alma raporları', 'alış raporu'],
      run: ({ navigate }) => navigate(REPORTS_BASE),
    },
    ...REPORTS.map((r): Command => ({
      id: `purchasing.reports.${r.slug}`,
      group: 'navigation',
      icon: BarChart3,
      permission: r.permission,
      title: (t) => t(`report.${r.id}.title`, { ns: 'purchasing-reports' }),
      keywords: () => ['report', 'rapor', r.slug.replace(/-/g, ' ')],
      run: ({ navigate }) => navigate(`${REPORTS_BASE}/${r.slug}`),
    })),
  ]
}

/** Called once at startup by the shell; returns the unregister function. */
export function registerPurchaseReportsCommands(): () => void {
  return registerCommands(purchaseReportsCommands())
}
