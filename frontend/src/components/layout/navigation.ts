import {
  Activity,
  Banknote,
  BookOpenText,
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
import { REF_PERMISSIONS } from '@/features/reference/permissions'
// Permission names mirror each feature's routes.tsx guards.
import type { PermissionRequirement } from '@/lib/permissions'

export type NavKey =
  | 'dashboard'
  | 'sales'
  | 'purchasing'
  | 'inventory'
  | 'accounting'
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

export type NavSectionKey = 'main' | 'masterData' | 'reference' | 'system'

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
      { key: 'sales', icon: ReceiptText },
      { key: 'purchasing', icon: ShoppingBasket },
      { key: 'inventory', icon: Boxes },
      { key: 'accounting', icon: BookOpenText },
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
        permission: 'item_categories.manage',
      },
      {
        key: 'units',
        icon: Ruler,
        to: '/catalog/units',
        permission: 'units.manage',
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
        permission: 'discount_rules.manage',
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
