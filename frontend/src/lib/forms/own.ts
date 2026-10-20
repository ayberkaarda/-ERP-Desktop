/** Own-property read: keys like "constructor" or "__proto__" never resolve to inherited values. */
export function ownValue<T>(
  record: Readonly<Record<string, T>> | null | undefined,
  key: string,
): T | undefined {
  return record && Object.hasOwn(record, key) ? record[key] : undefined
}
