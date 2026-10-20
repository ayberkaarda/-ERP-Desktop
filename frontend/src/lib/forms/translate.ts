import type { i18n as I18n, ParseKeys } from 'i18next'

/** Validation messages are `common` keys; server messages arrive already localized. */
export function translateMessage(i18n: I18n, message: string | undefined): string | undefined {
  if (!message) return undefined
  if (!i18n.exists(message.slice(0), { ns: 'common' })) return message
  // tsc needs the key type; the linter cannot see the typed-resources overload and disagrees.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return i18n.t(message as ParseKeys<'common'>, { ns: 'common' })
}
