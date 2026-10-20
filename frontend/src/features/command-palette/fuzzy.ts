// Folds case and Turkish/Latin diacritics so "sirket" finds "Şirket" and "musteri" finds "Müşteri".
const FOLD: Record<string, string> = { ı: 'i', İ: 'i', ş: 's', ğ: 'g', ü: 'u', ö: 'o', ç: 'c' }

export function fold(value: string): string {
  return value
    .replace(/[ıİşğüöç]/g, (c) => FOLD[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/**
 * Subsequence score: every query character must appear in order. Consecutive runs and
 * word-start hits score higher; null means no match.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = fold(query).replace(/\s+/g, '')
  if (!q) return 0
  const s = fold(text)
  let score = 0
  let qi = 0
  let prev = -2
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] !== q[qi]) continue
    const wordStart = i === 0 || /[\s\-_/.:]/.test(s[i - 1] ?? '')
    score += 1 + (i === prev + 1 ? 3 : 0) + (wordStart ? 4 : 0)
    prev = i
    qi++
  }
  if (qi < q.length) return null
  // Prefer shorter targets and early first hits.
  return score - s.length * 0.01 + (s.startsWith(q) ? 5 : 0)
}

/** Best score across several fields (title, keywords). */
export function bestScore(query: string, fields: readonly string[]): number | null {
  let best: number | null = null
  for (const f of fields) {
    const score = fuzzyScore(query, f)
    if (score !== null && (best === null || score > best)) best = score
  }
  return best
}
