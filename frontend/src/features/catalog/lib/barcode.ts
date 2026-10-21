import type { BarcodeType } from '../types'

// GS1 mod-10 check digit, the same rule the API applies when a barcode declares its type.

const LENGTH: Record<Exclude<BarcodeType, 'other'>, number> = { ean13: 13, ean8: 8, upca: 12 }

/** Every character is ASCII 0-9: no whitespace, newline or non-Latin digits slip through. */
export function isAsciiDigits(value: string): boolean {
  if (value.length === 0) return false
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    if (c < 48 || c > 57) return false
  }
  return true
}

/** Check digit for the payload digits (all but the last): weights 3,1,3,... from the right. */
export function gs1CheckDigit(payload: string): number {
  if (!isAsciiDigits(payload)) throw new Error('digits only')
  let sum = 0
  for (let i = 0; i < payload.length; i++) {
    const digit = payload.charCodeAt(payload.length - 1 - i) - 48
    sum += digit * (i % 2 === 0 ? 3 : 1)
  }
  return (10 - (sum % 10)) % 10
}

export type BarcodeProblem = 'empty' | 'digits' | 'length' | 'checkDigit'

export interface BarcodeCheck {
  ok: boolean
  problem?: BarcodeProblem
  /** Digit the code should end with (length is right, check digit is wrong). */
  expected?: number
  expectedLength?: number
}

export function validateBarcode(value: string, type: BarcodeType): BarcodeCheck {
  const code = value.trim()
  if (code === '') return { ok: false, problem: 'empty' }
  if (type === 'other') return { ok: true }
  const expectedLength = LENGTH[type]
  if (!isAsciiDigits(code)) return { ok: false, problem: 'digits', expectedLength }
  if (code.length !== expectedLength) return { ok: false, problem: 'length', expectedLength }
  const expected = gs1CheckDigit(code.slice(0, -1))
  if (Number(code.at(-1)) !== expected) {
    return { ok: false, problem: 'checkDigit', expected, expectedLength }
  }
  return { ok: true }
}

export const isValidEan13 = (code: string) => validateBarcode(code, 'ean13').ok
export const isValidEan8 = (code: string) => validateBarcode(code, 'ean8').ok
export const isValidUpcA = (code: string) => validateBarcode(code, 'upca').ok

/** Best guess of the symbology for a scanned value (used to preselect the type). */
export function detectBarcodeType(value: string): BarcodeType {
  const code = value.trim()
  if (isValidEan13(code)) return 'ean13'
  if (isValidUpcA(code)) return 'upca'
  if (isValidEan8(code)) return 'ean8'
  return 'other'
}
