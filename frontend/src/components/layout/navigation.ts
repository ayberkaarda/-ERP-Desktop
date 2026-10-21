import {
  Activity,
  FilePen,
  FileText,
  RotateCcw,
  ShoppingCart,
  Truck,
  ArrowLeftRight,
  Barcode,
  ChartColumn,
  ClipboardCheck,
  ClipboardList,
  Layers,
  Lock,
  Banknote,
  BookOpenText,
  BookText,
  CalendarDays,
  CalendarRange,
  FileSpreadsheet,
  GitBranch,
  ListTree,
  NotebookPen,
  Boxes,
  Calculator,
  CalendarClock,
  Coins,
  FolderKanban,
  FolderTree,
  Handshake,
  LayoutDashboard,
  Network,
  Package,
  Percent,
  ReceiptText,
  Ruler,
  Settings2,
  ShoppingBasket,
  Tag,
  TicketPercent,
  UsersRound,
  WalletCards,
  Warehouse,
  type LucideIcon,
} from 'lucide-react'
import { ACC_ACCESS, ACC_PERMISSIONS } from '@/features/accounting/shared/permissions'
import { CATALOG_OPEN } from '@/features/catalog/permissions'
import { INV_OPEN, INV_PERMS } from '@/features/inventory/documents/permissions'
import { INV_ACCESS } from '@/features/inventory/stock/lib/permissions'
import { REF_PERMISSIONS } from '@/features/reference/permissions'
// Permission names mirror each feature's routes.tsx guards.
import { anyOf, type PermissionRequirement } from '@/lib/permissions'

export type NavKey =
  | 'dashboard'
  | 'sales'
  | 'purchasing'
  | 'inventory'
  | 'treasury'
  | 'hr'
  | 'health'
  | 'parties'
  | 'items'
  | 'categories'
  | 'units'
  | 'priceLists'
  | 'discountRules'
  | 'pricing'
  | 'currencies'
  | 'exchangeRates'
  | 'taxCodes'
  | 'paymentTerms'
  | 'warehouses'
  | 'costCenters'
  | 'projects'
  | 'referenceSettings'
  | 'journalEntries'
  | 'chartOfAccounts'
  | 'trialBalance'
  | 'generalLedger'
  | 'journalBook'
  | 'fiscalYears'
  | 'accountingPeriods'
  | 'accountDetermination'
  | 'stockStatus'
  | 'stockMovements'
  | 'stockDocuments'
  | 'stockCounts'
  | 'stockReservations'
  | 'stockLots'
  | 'stockSerials'
  | 'stockWarehouses'
  | 'inventoryReports'
  | 'salesQuotes'
  | 'salesOrders'
  | 'salesDeliveries'
  | 'salesInvoices'
  | 'salesReturns'
  | 'salesReports'

export type NavSectionKey =
  'main' | 'masterData' | 'sales' | 'accounting' | 'inventory' | 'reference' | 'system'

export interface NavItem {
  key: NavKey
  icon: LucideIcon
  /** Items without `to` are modules scheduled for later phases. */
  to?: string
  /** Hidden unless the active company grants it; mirrors the route guard of `to`. */
  permission?: PermissionRequirement
}

export interface NavSection {
  key: NavSectionKey
  items: NavItem[]
}

export const NAV_SECTIONS: NavSection[] = [
  {
    key: 'main',
    items: [
      { key: 'dashboard', icon: LayoutDashboard, to: '/' },
      { key: 'purchasing', icon: ShoppingBasket },
      { key: 'treasury', icon: WalletCards },
      { key: 'hr', icon: UsersRound },
    ],
  },
  {
    key: 'masterData',
    items: [
      { key: 'parties', icon: Handshake, to: '/parties', permission: 'parties.view' },
      {
        key: 'items',
        icon: Package,
        to: '/catalog/items',
        permission: 'items.view',
      },
      {
        key: 'categories',
        icon: FolderTree,
        to: '/catalog/categories',
        permission: CATALOG_OPEN.categories,
      },
      {
        key: 'units',
        icon: Ruler,
        to: '/catalog/units',
        permission: CATALOG_OPEN.units,
      },
      {
        key: 'priceLists',
        icon: Tag,
        to: '/catalog/price-lists',
        permission: 'price_lists.view',
      },
      {
        key: 'discountRules',
        icon: TicketPercent,
        to: '/catalog/discount-rules',
        permission: CATALOG_OPEN.discountRules,
      },
      {
        key: 'pricing',
        icon: Calculator,
        to: '/catalog/pricing',
        permission: 'pricing.view',
      },
    ],
  },
  {
    key: 'sales',
    items: [
      {
        key: 'salesQuotes',
        icon: FilePen,
        to: '/sales/quotes',
        permission: 'sales.quotes.view',
      },
      {
        key: 'salesOrders',
        icon: ShoppingCart,
        to: '/sales/orders',
        permission: 'sales.orders.view',
      },
      {
        key: 'salesDeliveries',
        icon: Truck,
        to: '/sales/deliveries',
        permission: 'sales.deliveries.view',
      },
      {
        key: 'salesInvoices',
        icon: ReceiptText,
        to: '/sales/invoices',
        permission: 'sales.invoices.view',
      },
      {
        key: 'salesReturns',
        icon: RotateCcw,
        to: '/sales/returns',
        permission: 'sales.returns.view',
      },
      {
        key: 'salesReports',
        icon: FileText,
        to: '/sales/reports',
        permission: 'sales.reports.view',
      },
    ],
  },
  {
    key: 'inventory',
    items: [
      {
        key: 'stockStatus',
        icon: Boxes,
        to: '/inventory/stock',
        permission: INV_ACCESS.stock,
      },
      {
        key: 'stockMovements',
        icon: ArrowLeftRight,
        to: '/inventory/movements',
        permission: INV_ACCESS.stock,
      },
      {
        key: 'stockDocuments',
        icon: ClipboardList,
        to: '/inventory/documents',
        permission: INV_OPEN.documents,
      },
      {
        key: 'stockCounts',
        icon: ClipboardCheck,
        to: '/inventory/counts',
        permission: INV_OPEN.documents,
      },
      {
        key: 'stockReservations',
        icon: Lock,
        to: '/inventory/reservations',
        permission: INV_OPEN.reservations,
      },
      {
        key: 'stockLots',
        icon: Layers,
        to: '/inventory/lots',
        permission: INV_ACCESS.stock,
      },
      {
        key: 'stockSerials',
        icon: Barcode,
        to: '/inventory/serials',
        permission: INV_ACCESS.stock,
      },
      {
        key: 'stockWarehouses',
        icon: Warehouse,
        to: '/inventory/warehouses',
        permission: INV_ACCESS.warehouses,
      },
      {
        key: 'inventoryReports',
        icon: ChartColumn,
        to: '/inventory/reports',
        permission: anyOf(INV_PERMS.reportsView, INV_PERMS.stockView),
      },
    ],
  },
  {
    key: 'accounting',
    items: [
      {
        key: 'journalEntries',
        icon: NotebookPen,
        to: '/accounting/journal-entries',
        permission: 'accounting.entries.view',
      },
      {
        key: 'chartOfAccounts',
        icon: ListTree,
        to: '/accounting/accounts',
        permission: ACC_ACCESS.accounts,
      },
      {
        key: 'trialBalance',
        icon: FileSpreadsheet,
        to: '/accounting/reports/trial-balance',
        permission: 'accounting.reports.view',
      },
      {
        key: 'generalLedger',
        icon: BookOpenText,
        to: '/accounting/reports/general-ledger',
        permission: 'accounting.reports.view',
      },
      {
        key: 'journalBook',
        icon: BookText,
        to: '/accounting/reports/journal-book',
        permission: 'accounting.reports.view',
      },
      {
        key: 'fiscalYears',
        icon: CalendarRange,
        to: '/accounting/fiscal-years',
        permission: ACC_ACCESS.fiscalYears,
      },
      {
        key: 'accountingPeriods',
        icon: CalendarDays,
        to: '/accounting/periods',
        permission: ACC_ACCESS.periods,
      },
      {
        key: 'accountDetermination',
        icon: GitBranch,
        to: '/accounting/determination',
        permission: ACC_PERMISSIONS.determination.manage,
      },
    ],
  },
  {
    key: 'reference',
    items: [
      {
        key: 'currencies',
        icon: Coins,
        to: '/reference/currencies',
        permission: REF_PERMISSIONS.currencies.view,
      },
      {
        key: 'exchangeRates',
        icon: Banknote,
        to: '/reference/exchange-rates',
        permission: REF_PERMISSIONS.exchangeRates.view,
      },
      {
        key: 'taxCodes',
        icon: Percent,
        to: '/reference/tax-codes',
        permission: REF_PERMISSIONS.taxCodes.view,
      },
      {
        key: 'paymentTerms',
        icon: CalendarClock,
        to: '/reference/payment-terms',
        permission: REF_PERMISSIONS.paymentTerms.view,
      },
      {
        key: 'warehouses',
        icon: Warehouse,
        to: '/reference/warehouses',
        permission: REF_PERMISSIONS.warehouses.view,
      },
      {
        key: 'costCenters',
        icon: Network,
        to: '/reference/cost-centers',
        permission: REF_PERMISSIONS.costCenters.view,
      },
      {
        key: 'projects',
        icon: FolderKanban,
        to: '/reference/projects',
        permission: REF_PERMISSIONS.projects.view,
      },
      {
        key: 'referenceSettings',
        icon: Settings2,
        to: '/reference/settings',
        permission: REF_PERMISSIONS.settings.view,
      },
    ],
  },
  { key: 'system', items: [{ key: 'health', icon: Activity, to: '/system/health' }] },
]
