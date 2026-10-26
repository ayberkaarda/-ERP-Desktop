import type { TFunction } from 'i18next'
import {
  Banknote,
  Boxes,
  CalendarClock,
  Coins,
  FolderKanban,
  Network,
  Percent,
  Settings2,
  Warehouse,
} from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { REFERENCE_NS } from './i18n'
import { REF_PERMISSIONS } from './permissions'

type Translate = (key: string, options: { ns: string }) => string

// Titles live in the `reference` namespace; the palette hands over the default translator.
const title = (key: string) => (t: TFunction) =>
  (t as unknown as Translate)(key, { ns: REFERENCE_NS })

const nav = (
  id: string,
  path: string,
  key: string,
  permission: string,
  icon: Command['icon'],
  keywords: string[] = [],
): Command => ({
  id: `reference.${id}`,
  group: 'navigation',
  icon,
  permission,
  title: title(`commands.${key}`),
  keywords: () => ['reference', 'referans', ...keywords],
  run: ({ navigate }) => navigate(path),
})

export const referenceCommands: readonly Command[] = [
  nav('currencies', '/reference/currencies', 'currencies', REF_PERMISSIONS.currencies.view, Coins, [
    'currency',
    'para birimi',
  ]),
  nav(
    'exchange-rates',
    '/reference/exchange-rates',
    'exchangeRates',
    REF_PERMISSIONS.exchangeRates.view,
    Banknote,
    ['kur', 'exchange rate', 'tcmb'],
  ),
  nav('tax-codes', '/reference/tax-codes', 'taxCodes', REF_PERMISSIONS.taxCodes.view, Percent, [
    'kdv',
    'vat',
    'tevkifat',
    'vergi',
  ]),
  nav(
    'payment-terms',
    '/reference/payment-terms',
    'paymentTerms',
    REF_PERMISSIONS.paymentTerms.view,
    CalendarClock,
    ['vade', 'ödeme koşulu'],
  ),
  nav(
    'warehouses',
    '/reference/warehouses',
    'warehouses',
    REF_PERMISSIONS.warehouses.view,
    Warehouse,
    ['depo', 'lokasyon'],
  ),
  nav(
    'cost-centers',
    '/reference/cost-centers',
    'costCenters',
    REF_PERMISSIONS.costCenters.view,
    Network,
    ['masraf merkezi'],
  ),
  nav('projects', '/reference/projects', 'projects', REF_PERMISSIONS.projects.view, FolderKanban, [
    'proje',
  ]),
  nav('settings', '/reference/settings', 'settings', REF_PERMISSIONS.settings.view, Settings2, [
    'base currency',
    'ana para birimi',
  ]),
  {
    id: 'reference.rate-entry',
    group: 'actions',
    icon: Boxes,
    permission: REF_PERMISSIONS.exchangeRates.manage,
    title: title('commands.rateEntry'),
    keywords: () => ['kur gir', 'manual rate', 'exchange rate'],
    run: ({ navigate }) => navigate('/reference/exchange-rates?entry=1'),
  },
]

/** Adds the Reference entries to the command palette; returns the function that removes them. */
export function registerReferenceCommands(): () => void {
  return registerCommands(referenceCommands)
}
