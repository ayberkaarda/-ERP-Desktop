import { makeParty } from '@/test/handlers/parties'
import {
  emptyPartyValues,
  formValuesToInput,
  parseTags,
  partyFormSchema,
  partyToFormValues,
  V,
} from './party'
import { addressSchema, bankAccountSchema, contactSchema, toSubresourceInput } from './subresources'

const issues = (result: {
  success: boolean
  error?: { issues: { path: PropertyKey[]; message: string }[] }
}) => Object.fromEntries((result.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]))

describe('partyFormSchema', () => {
  it('needs a name and at least one role', () => {
    const r = partyFormSchema.safeParse(emptyPartyValues({ roles: [] }))
    expect(issues(r)).toMatchObject({ name: 'validation.required', roles: V.rolesRequired })
  })

  it('applies the tax number rule for the country and type', () => {
    const company = emptyPartyValues({ name: 'A', tax_number: '1234567891' })
    expect(issues(partyFormSchema.safeParse(company)).tax_number).toBe(V.vknChecksum)
    const person = emptyPartyValues({ name: 'A', type: 'person', tax_number: '1234567890' })
    expect(issues(partyFormSchema.safeParse(person)).tax_number).toBe(V.tcknLength)
    const foreign = emptyPartyValues({ name: 'A', country: 'DE', tax_number: 'DE123456789' })
    expect(partyFormSchema.safeParse(foreign).success).toBe(true)
  })

  it('requires a risk currency once a risk limit is set', () => {
    const v = emptyPartyValues({ name: 'A', risk_limit: '1500.50' })
    expect(issues(partyFormSchema.safeParse(v)).risk_currency_code).toBe(V.riskCurrency)
    expect(partyFormSchema.safeParse({ ...v, risk_currency_code: 'TRY' }).success).toBe(true)
  })
})

describe('form <-> API mapping', () => {
  it('round-trips a party and keeps fields the form does not edit', () => {
    const party = makeParty({
      risk_limit: '1500.0000',
      risk_currency_code: 'EUR',
      tags: ['ihracat', 'öncelikli'],
      payment_term_id: 'pt-1',
    })
    const values = partyToFormValues(party)
    expect(values.risk_limit).toBe('1500')
    expect(values.tags).toBe('ihracat, öncelikli')
    const input = formValuesToInput({ ...values, legal_name: '  ' }, party)
    expect(input).toMatchObject({
      legal_name: null,
      payment_term_id: 'pt-1',
      tags: ['ihracat', 'öncelikli'],
    })
  })

  it('parses tags without blanks or repeats', () => {
    expect(parseTags(' a, b ,, a ,c')).toEqual(['a', 'b', 'c'])
  })
})

describe('sub-resource schemas', () => {
  it('validates IBAN, SWIFT and e-mail', () => {
    const bank = {
      bank_name: 'Banka',
      iban: 'TR33 0006 1005 1978 6457 8413 27',
      swift: 'X',
      currency_code: 'TRY',
      is_default: false,
    }
    expect(issues(bankAccountSchema.safeParse(bank))).toEqual({
      iban: V.ibanChecksum,
      swift: V.swift,
    })
    const contact = { name: 'Ayşe', title: '', email: 'not-mail', phone: '', is_primary: false }
    expect(issues(contactSchema.safeParse(contact)).email).toBe(V.email)
  })

  it('requires the address lines that make it deliverable', () => {
    const r = addressSchema.safeParse({
      type: 'billing',
      label: '',
      line1: '',
      line2: '',
      district: '',
      city: '',
      postal_code: '',
      country: 'TR',
      is_default: false,
    })
    expect(Object.keys(issues(r))).toEqual(['line1', 'city'])
  })

  it('sends empty optional strings as null and normalizes IBAN', () => {
    expect(
      toSubresourceInput({
        iban: 'tr33 0006',
        swift: '',
        label: '',
        city: ' Ankara ',
        is_default: true,
      }),
    ).toEqual({
      iban: 'TR330006',
      swift: null,
      label: null,
      city: 'Ankara',
      is_default: true,
    })
  })
})
