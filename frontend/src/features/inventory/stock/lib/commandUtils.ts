import type { TFunction } from 'i18next'
import type { Command } from '@/features/command-palette/registry'
import type { PermissionRequirement } from '@/lib/permissions'
import { INVENTORY_STOCK_NS } from './i18n'

type Translate = (key: string, options: { ns: string }) => string

/** Palette titles live in the `inventory-stock` namespace; the palette hands over the default t. */
export const invTitle = (key: string) => (t: TFunction) =>
  (t as unknown as Translate)(key, { ns: INVENTORY_STOCK_NS })

export function navCommand(
  id: string,
  path: string,
  key: string,
  permission: PermissionRequirement,
  icon: Command['icon'],
  keywords: string[],
  group: Command['group'] = 'navigation',
): Command {
  return {
    id: `inventory.${id}`,
    group,
    icon,
    permission,
    title: invTitle(`common.commands.${key}`),
    keywords: () => ['stok', 'depo', 'inventory', 'stock', ...keywords],
    run: ({ navigate }) => navigate(path),
  }
}
