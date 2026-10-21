import type { TFunction } from 'i18next'
import type { Command } from '@/features/command-palette/registry'
import type { PermissionRequirement } from '@/lib/permissions'
import { ACCOUNTING_NS } from './i18n'

type Translate = (key: string, options: { ns: string }) => string

/** Palette titles live in the `accounting` namespace; the palette hands over the default t. */
export const accTitle = (key: string) => (t: TFunction) =>
  (t as unknown as Translate)(key, { ns: ACCOUNTING_NS })

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
    id: `accounting.${id}`,
    group,
    icon,
    permission,
    title: accTitle(`common.commands.${key}`),
    keywords: () => ['muhasebe', 'accounting', ...keywords],
    run: ({ navigate }) => navigate(path),
  }
}
