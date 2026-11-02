import { describe, expect, it } from 'vitest'

import { desktopResources, DESKTOP_LANGUAGES } from '../../i18n'

describe('account locales', () => {
  it('every language uses the same placeholders as Turkish', () => {
    const holders = (value: unknown, prefix = ''): [string, string][] =>
      typeof value === 'string'
        ? [[prefix, [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(',')]]
        : Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => holders(v, prefix ? `${prefix}.${k}` : k))
    const source = holders(desktopResources.tr)
    for (const lang of DESKTOP_LANGUAGES) expect(holders(desktopResources[lang])).toEqual(source)
  })
})
