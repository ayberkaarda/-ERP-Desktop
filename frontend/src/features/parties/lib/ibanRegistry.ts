// BBAN layouts from the SWIFT IBAN registry (ISO 13616-2), Release 99 (December 2024), retrieved
// 2026-10-21 and cross-checked against two independent tables. Single source of truth:
// contracts/iban-registry.json (a test fails when this table drifts from it).
// n = digit, a = upper-case letter, c = letter or digit; adjacent parts of one type are merged.
// The IBAN length is 4 (country + check digits) plus the BBAN length.
export const BBAN_FORMATS: Readonly<Record<string, string>> = {
  AD: '8n12c',
  AE: '19n',
  AL: '8n16c',
  AT: '16n',
  AZ: '4a20c',
  BA: '16n',
  BE: '12n',
  BG: '4a6n8c',
  BH: '4a14c',
  BI: '23n',
  BR: '23n1a1c',
  BY: '4c4n16c',
  CH: '5n12c',
  CR: '18n',
  CY: '8n16c',
  CZ: '20n',
  DE: '18n',
  DJ: '23n',
  DK: '14n',
  DO: '4c20n',
  EE: '16n',
  EG: '25n',
  ES: '20n',
  FI: '14n',
  FK: '2a12n',
  FO: '14n',
  FR: '10n11c2n',
  GB: '4a14n',
  GE: '2a16n',
  GI: '4a15c',
  GL: '14n',
  GR: '7n16c',
  GT: '24c',
  HN: '4a20n',
  HR: '17n',
  HU: '24n',
  IE: '4a14n',
  IL: '19n',
  IQ: '4a15n',
  IS: '22n',
  IT: '1a10n12c',
  JO: '4a4n18c',
  KW: '4a22c',
  KZ: '3n13c',
  LB: '4n20c',
  LC: '4a24c',
  LI: '5n12c',
  LT: '16n',
  LU: '3n13c',
  LV: '4a13c',
  LY: '21n',
  MC: '10n11c2n',
  MD: '20c',
  ME: '18n',
  MK: '3n10c2n',
  MN: '16n',
  MR: '23n',
  MT: '4a5n18c',
  MU: '4a19n3a',
  NI: '4a20n',
  NL: '4a10n',
  NO: '11n',
  OM: '3n16c',
  PK: '4a16c',
  PL: '24n',
  PS: '4a21c',
  PT: '21n',
  QA: '4a21c',
  RO: '4a16c',
  RS: '18n',
  RU: '14n15c',
  SA: '2n18c',
  SC: '4a20n3a',
  SD: '14n',
  SE: '20n',
  SI: '15n',
  SK: '20n',
  SM: '1a10n12c',
  SO: '19n',
  ST: '21n',
  SV: '4a20n',
  TL: '19n',
  TN: '20n',
  TR: '6n16c',
  UA: '6n19c',
  VA: '18n',
  VG: '4a16n',
  XK: '16n',
  YE: '4a4n18c',
}

const CLASS = { n: '[0-9]', a: '[A-Z]', c: '[A-Z0-9]' } as const

interface Layout {
  length: number
  bban: RegExp
}

const cache = new Map<string, Layout>()

/** Expected IBAN length and BBAN pattern for a country, or null when it has no IBAN. */
export function ibanLayout(country: string): Layout | null {
  const cached = cache.get(country)
  if (cached) return cached
  const format = Object.hasOwn(BBAN_FORMATS, country) ? BBAN_FORMATS[country] : undefined
  if (!format) return null
  let length = 4
  let source = ''
  for (const [, count, kind] of format.matchAll(/(\d+)([nac])/g)) {
    length += Number(count)
    source += `${CLASS[kind as keyof typeof CLASS]}{${count}}`
  }
  const layout = { length, bban: new RegExp(`^${source}$`) }
  cache.set(country, layout)
  return layout
}
