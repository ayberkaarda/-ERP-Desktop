import { useQuery } from '@tanstack/react-query'
import { ShieldAlert, ShieldCheck, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { partiesApi, PartyCombobox, type Party, type PartyComboboxProps } from '@/features/parties'
import { useIntlLocale } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { usePermission } from '@/lib/permissions'
import { useCompanyStore } from '@/stores/company'
import { useSupplierExposure } from '../hooks/queries'
import { exposureView } from '../lib/exposure'
import { PURCH_ACCESS } from '../permissions'

interface SupplierPickerProps extends Omit<
  PartyComboboxProps,
  'role' | 'value' | 'onChange' | 'initialParty' | 'showRoles'
> {
  value: string
  /** Name known from the document (party snapshot); looked up when missing. */
  name?: string
  onChange: (id: string | null, party: Party | null) => void
}

/** Suppliers only; the stored selection keeps its name (read from Parties when not given). */
export function SupplierPicker({ value, name, onChange, ...props }: SupplierPickerProps) {
  const company = useCompanyStore((s) => s.activeCompanyId)
  const canRead = usePermission('parties.view')
  const lookup = useQuery({
    queryKey: ['purchasing', company ?? 'none', 'party', value],
    queryFn: ({ signal }) => partiesApi.get(value, signal),
    enabled: canRead && value !== '' && !name,
    staleTime: 5 * 60_000,
    retry: false,
  })
  const known = name ?? lookup.data?.name
  return (
    <PartyCombobox
      {...props}
      // Remount once when a looked-up name arrives so the stored selection shows it.
      key={lookup.isSuccess ? 'looked-up' : 'initial'}
      role="supplier"
      showRoles={false}
      value={value || null}
      initialParty={
        value && known ? { id: value, code: '', name: known, roles: ['supplier'] } : null
      }
      onChange={onChange}
    />
  )
}

interface ExposureBadgeProps {
  partyId: string
  /** This document's total in company currency (added while it is not counted yet). */
  documentTotalLocal?: string | null
  /** The document is approved or later and already part of the exposure. */
  counted?: boolean
}

const TONE = { none: 'neutral', open: 'info', overdue: 'warning' } as const

/** Informational supplier exposure: open payables, approved orders not invoiced, overdue. */
export function SupplierExposureBadge({
  partyId,
  documentTotalLocal = null,
  counted = false,
}: ExposureBadgeProps) {
  const { t } = useTranslation('purchasing-orders')
  const locale = useIntlLocale()
  const allowed = usePermission(PURCH_ACCESS.exposure)
  const exposure = useSupplierExposure(partyId)
  if (!allowed || !partyId) return null
  if (exposure.isPending)
    return (
      <span className="text-xs text-muted-foreground" role="status">
        {t('exposure.loading')}
      </span>
    )
  if (exposure.isError)
    return (
      <span className="text-xs text-muted-foreground" role="status">
        {t('exposure.unavailable')}
      </span>
    )
  const e = exposure.data
  const view = exposureView(e, documentTotalLocal, counted)
  const money = (v: string) => formatMoney(v, e.currency, locale)
  const Icon = view.tone === 'overdue' ? ShieldAlert : view.tone === 'open' ? Wallet : ShieldCheck
  return (
    <div className="space-y-0.5" data-testid="supplier-exposure">
      <Badge tone={TONE[view.tone]} className="h-auto py-0.5 whitespace-normal">
        <Icon aria-hidden="true" />
        {view.tone === 'overdue'
          ? t('exposure.overdue', { amount: money(e.overdue_payables) })
          : t('exposure.total', { amount: money(e.total) })}
      </Badge>
      <p className="text-2xs text-muted-foreground">
        {t('exposure.breakdown', {
          payables: money(e.open_payables),
          orders: money(e.open_orders),
        })}
        {view.after !== null && ` · ${t('exposure.after', { amount: money(view.after) })}`}
      </p>
    </div>
  )
}
