import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useIntlLocale } from '@/lib/datetime'
import { formatIban } from '../lib/iban'
import { countryOptions, currencyOptions } from '../lib/options'
import {
  addressSchema,
  bankAccountSchema,
  contactSchema,
  toSubresourceInput,
  type AddressFormValues,
  type BankAccountFormValues,
  type ContactFormValues,
} from '../schemas/subresources'
import {
  ADDRESS_TYPES,
  type PartyAddress,
  type PartyBankAccount,
  type PartyContact,
} from '../types'
import { SubresourceEditor, type EditorColumn } from './SubresourceEditor'

interface Props {
  partyId: string
  canEdit: boolean
  /** Country of the party: new addresses start with it. */
  country?: string
}

const s = (v: string | null | undefined) => v ?? ''

export function AddressesEditor({ partyId, canEdit, country = 'TR' }: Props) {
  const { t } = useTranslation('parties')
  const locale = useIntlLocale()
  const columns = useMemo<EditorColumn<AddressFormValues>[]>(
    () => [
      {
        name: 'type',
        label: t('address.type'),
        options: ADDRESS_TYPES.map((v) => ({ value: v, label: t(`address.types.${v}`) })),
        required: true,
      },
      { name: 'label', label: t('address.label') },
      { name: 'line1', label: t('address.line1'), required: true },
      { name: 'line2', label: t('address.line2'), className: 'hidden lg:table-cell' },
      { name: 'district', label: t('address.district') },
      { name: 'city', label: t('address.city'), required: true },
      { name: 'postal_code', label: t('address.postal_code'), kind: 'code' },
      {
        name: 'country',
        label: t('address.country'),
        options: countryOptions(locale),
        required: true,
        display: (v) => <span className="font-code">{String(v)}</span>,
      },
    ],
    [t, locale],
  )
  return (
    <SubresourceEditor<PartyAddress, AddressFormValues>
      partyId={partyId}
      kind="addresses"
      title={t('detail.addresses')}
      columns={columns}
      schema={addressSchema}
      emptyValues={{
        type: 'billing',
        label: '',
        line1: '',
        line2: '',
        district: '',
        city: '',
        postal_code: '',
        country,
        is_default: false,
      }}
      toValues={(r) => ({
        type: r.type,
        label: s(r.label),
        line1: r.line1,
        line2: s(r.line2),
        district: s(r.district),
        city: r.city,
        postal_code: s(r.postal_code),
        country: r.country,
        is_default: r.is_default,
      })}
      toInput={toSubresourceInput}
      rule={{ flag: 'is_default', scope: (r) => r.type }}
      flagLabel={t('sub.default')}
      makeFlagLabel={t('sub.makeDefault')}
      emptyText={t('address.empty')}
      canEdit={canEdit}
    />
  )
}

export function ContactsEditor({ partyId, canEdit }: Props) {
  const { t } = useTranslation('parties')
  const columns = useMemo<EditorColumn<ContactFormValues>[]>(
    () => [
      { name: 'name', label: t('contact.name'), required: true },
      { name: 'title', label: t('contact.title') },
      { name: 'email', label: t('contact.email'), kind: 'email' },
      { name: 'phone', label: t('contact.phone'), kind: 'tel' },
    ],
    [t],
  )
  return (
    <SubresourceEditor<PartyContact, ContactFormValues>
      partyId={partyId}
      kind="contacts"
      title={t('detail.contacts')}
      columns={columns}
      schema={contactSchema}
      emptyValues={{ name: '', title: '', email: '', phone: '', is_primary: false }}
      toValues={(r) => ({
        name: r.name,
        title: s(r.title),
        email: s(r.email),
        phone: s(r.phone),
        is_primary: r.is_primary,
      })}
      toInput={toSubresourceInput}
      rule={{ flag: 'is_primary' }}
      flagLabel={t('sub.primary')}
      makeFlagLabel={t('sub.makePrimary')}
      emptyText={t('contact.empty')}
      canEdit={canEdit}
    />
  )
}

export function BankAccountsEditor({ partyId, canEdit }: Props) {
  const { t } = useTranslation('parties')
  const locale = useIntlLocale()
  const columns = useMemo<EditorColumn<BankAccountFormValues>[]>(
    () => [
      { name: 'bank_name', label: t('bank.bank_name'), required: true },
      {
        name: 'iban',
        label: t('bank.iban'),
        kind: 'code',
        required: true,
        display: (v) => <span className="font-code">{formatIban(String(v))}</span>,
      },
      { name: 'swift', label: t('bank.swift'), kind: 'code' },
      {
        name: 'currency_code',
        label: t('bank.currency_code'),
        options: currencyOptions(locale),
      },
    ],
    [t, locale],
  )
  return (
    <SubresourceEditor<PartyBankAccount, BankAccountFormValues>
      partyId={partyId}
      kind="bank-accounts"
      title={t('detail.bankAccounts')}
      columns={columns}
      schema={bankAccountSchema}
      emptyValues={{ bank_name: '', iban: '', swift: '', currency_code: 'TRY', is_default: false }}
      toValues={(r) => ({
        bank_name: r.bank_name,
        iban: formatIban(r.iban),
        swift: s(r.swift),
        currency_code: s(r.currency_code),
        is_default: r.is_default,
      })}
      toInput={toSubresourceInput}
      rule={{ flag: 'is_default' }}
      flagLabel={t('sub.default')}
      makeFlagLabel={t('sub.makeDefault')}
      emptyText={t('bank.empty')}
      canEdit={canEdit}
    />
  )
}
