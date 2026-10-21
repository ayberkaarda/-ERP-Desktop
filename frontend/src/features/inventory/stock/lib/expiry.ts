import { addDays } from '@/lib/datetime'

export type ExpiryState = 'none' | 'expired' | 'soon' | 'ok'

/** Lots within this many days of expiry are flagged. */
export const EXPIRY_WARNING_DAYS = 30

/** Calendar comparison only: YYYY-MM-DD strings sort as dates. */
export function expiryState(
  expiry: string | null | undefined,
  today: string,
  warnDays = EXPIRY_WARNING_DAYS,
): ExpiryState {
  if (!expiry) return 'none'
  if (expiry < today) return 'expired'
  if (expiry <= addDays(today, warnDays)) return 'soon'
  return 'ok'
}

/** Whole days from `today` to `expiry` (negative once expired). */
export function daysUntil(expiry: string, today: string): number {
  const utc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))
  return Math.round((utc(expiry) - utc(today)) / 86_400_000)
}
