// Client copy of the server rule; the API stays authoritative.

/** Turkish tax number: 10 digits, the last one is a check digit. */
export function isValidVkn(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false
  const d = Array.from(value, Number)
  let sum = 0
  for (let i = 0; i < 9; i++) {
    const tmp = ((d[i] ?? 0) + 9 - i) % 10
    let v = (tmp * 2 ** (9 - i)) % 9
    if (tmp !== 0 && v === 0) v = 9
    sum += v
  }
  return (10 - (sum % 10)) % 10 === d[9]
}
