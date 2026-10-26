/** Accepted value per filter key; anything not listed (or rejected) never reaches the API. */
export type FilterRules = Record<string, (value: string) => boolean>

/** Keeps only allowlisted filters with accepted values (URL params are untrusted input). */
export function acceptFilters(
  filters: Record<string, string>,
  rules: FilterRules,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(filters).filter(
      ([key, value]) => value !== '' && Object.hasOwn(rules, key) && rules[key]?.(value) === true,
    ),
  )
}

export const anyValue = (value: string) => value.trim() !== ''
export const isTrue = (value: string) => value === 'true'
