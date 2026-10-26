import { BarChart3, FileBarChart } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { anyOf } from '@/lib/permissions'
import { INV_PERMS } from '../documents/permissions'
import { REPORTS, REPORTS_BASE, type ReportId } from './definitions'

const KEYWORDS: Record<ReportId, string[]> = {
  stockStatus: ['stock status', 'stok durumu', 'eldeki stok', 'tarihli stok'],
  stockLedger: ['stock ledger', 'kartex', 'karteks', 'stok defteri', 'stok ekstresi'],
  valuation: ['valuation', 'stok değerleme', 'envanter değeri', 'maliyet'],
  ageing: ['ageing', 'yaşlandırma', 'stok yaşı', 'bekleyen stok'],
  expiringLots: ['expiring lots', 'son kullanma', 'skt', 'miadı dolan'],
  abc: ['abc analysis', 'abc analizi', 'pareto'],
  turnover: ['turnover', 'devir hızı', 'stok devri'],
  movementSummary: [
    'movement summary',
    'hareket özeti',
    'giriş çıkış özeti',
    'stok hareket raporu',
  ],
  reorder: ['reorder', 'sipariş önerisi', 'yeniden sipariş', 'kritik stok'],
}

/** Palette entries: the reports index and one per report, each gated by its permission. */
export function inventoryReportsCommands(): Command[] {
  return [
    {
      id: 'inventory.reports',
      group: 'navigation',
      icon: BarChart3,
      permission: anyOf(INV_PERMS.reportsView, INV_PERMS.stockView),
      title: (t) => t('nav.reports', { ns: 'inventoryDocs' }),
      keywords: () => ['inventory reports', 'stok raporları', 'depo raporları'],
      run: ({ navigate }) => navigate(REPORTS_BASE),
    },
    ...REPORTS.map((r): Command => ({
      id: `inventory.reports.${r.id}`,
      group: 'navigation',
      icon: FileBarChart,
      permission: r.permission,
      title: (t) => t(`report.${r.id}.title`, { ns: 'inventoryDocs' }),
      keywords: () => KEYWORDS[r.id],
      run: ({ navigate }) => navigate(`${REPORTS_BASE}/${r.slug}`),
    })),
  ]
}

/** Called once at startup by the shell; returns the unregister function. */
export function registerInventoryReportsCommands(): () => void {
  return registerCommands(inventoryReportsCommands())
}
