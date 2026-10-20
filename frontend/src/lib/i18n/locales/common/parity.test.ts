import de from './de.json'
import en from './en.json'
import fr from './fr.json'
import tr from './tr.json'

// The repo-wide i18n:check reads only top-level locale files; this guards the `common` namespace.
function entries(obj: object, prefix = ''): [string, string][] {
  return Object.entries(obj).flatMap(([key, value]: [string, unknown]): [string, string][] => {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'object' && value !== null) return entries(value, path)
    return [[path, String(value)]]
  })
}

const vars = (s: string) =>
  [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',')

describe('common namespace', () => {
  const source = new Map(entries(tr))
  it.each([
    ['en', en],
    ['de', de],
    ['fr', fr],
  ])('%s has the same keys and placeholders as tr', (_, locale) => {
    const target = new Map(entries(locale))
    expect([...target.keys()].sort()).toEqual([...source.keys()].sort())
    for (const [key, value] of source) expect(vars(target.get(key) ?? '')).toBe(vars(value))
  })
})
