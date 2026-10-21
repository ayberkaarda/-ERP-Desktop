// Client copy of the server rule; the API stays authoritative.

/** Turkish national id: 11 digits, no leading zero, two check digits. */
export function isValidTckn(value: string): boolean {
  if (!/^[1-9]\d{10}$/.test(value)) return false
  const d = Array.from(value, Number)
  const at = (i: number) => d[i] ?? 0
  const odd = at(0) + at(2) + at(4) + at(6) + at(8)
  const even = at(1) + at(3) + at(5) + at(7)
  if ((((odd * 7 - even) % 10) + 10) % 10 !== at(9)) return false
  const first10 = d.slice(0, 10).reduce((a, b) => a + b, 0)
  return first10 % 10 === at(10)
}
