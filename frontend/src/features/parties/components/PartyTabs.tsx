import { lazy, Suspense, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { AuditTrail } from '@/components/shared/AuditTrail'
import { AttachmentPanel } from '@/components/shared/attachments'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CUSTOMER_SALES_VIEW } from '@/features/sales/reports/lib/customer'
import { PURCH_OPEN } from '@/features/purchasing/invoices/kit/permissions'
import { usePermission } from '@/lib/permissions'
import { partyFilesApi } from '../api/parties'
import { usePartyAudit } from '../hooks/useParties'
import type { Party } from '../types'
import { AddressesEditor, BankAccountsEditor, ContactsEditor } from './PartySubresources'

type Tab =
  'addresses' | 'contacts' | 'bankAccounts' | 'sales' | 'purchases' | 'attachments' | 'history'
const BASE_TABS: Tab[] = ['addresses', 'contacts', 'bankAccounts']

// Sales code loads only when the tab is opened.
const CustomerSalesSummary = lazy(async () => ({
  default: (await import('@/features/sales/reports/components/CustomerSalesSummary'))
    .CustomerSalesSummary,
}))

const SupplierPurchaseSummary = lazy(async () => ({
  default: (await import('@/features/purchasing/reports/components/SupplierPurchaseSummary'))
    .SupplierPurchaseSummary,
}))

interface PartyTabsProps {
  party: Party
  canEdit: boolean
  /** Detail page also shows attachments and history. */
  withRecordTabs?: boolean
}

/** Active tab lives in `?tab=` so a reload or a shared link opens the same section. */
export function PartyTabs({ party, canEdit, withRecordTabs = false }: PartyTabsProps) {
  const { t } = useTranslation('parties')
  const [params, setParams] = useSearchParams()
  // The audit log is its own permission (GET /logs/audit needs audit.view).
  const canAudit = usePermission('audit.view')
  // Same gate as GET /customers/{id}/sales-summary (any sales document read permission).
  const canSales = usePermission(CUSTOMER_SALES_VIEW)
  const salesTabs: Tab[] = canSales && party.roles.includes('customer') ? ['sales'] : []
  const canPurchases = usePermission(PURCH_OPEN.supplierSummary)
  const purchaseTabs: Tab[] = canPurchases && party.roles.includes('supplier') ? ['purchases'] : []
  const recordTabs: Tab[] = canAudit ? ['attachments', 'history'] : ['attachments']
  const tabs: Tab[] = withRecordTabs
    ? [...BASE_TABS, ...salesTabs, ...purchaseTabs, ...recordTabs]
    : BASE_TABS
  const requested = params.get('tab') as Tab | null
  const current: Tab = requested && tabs.includes(requested) ? requested : 'addresses'

  const panels: Record<Tab, () => ReactNode> = {
    addresses: () => (
      <AddressesEditor partyId={party.id} canEdit={canEdit} country={party.country} />
    ),
    contacts: () => <ContactsEditor partyId={party.id} canEdit={canEdit} />,
    bankAccounts: () => <BankAccountsEditor partyId={party.id} canEdit={canEdit} />,
    sales: () => (
      <Suspense fallback={<Skeleton className="h-48 w-full" />}>
        <CustomerSalesSummary partyId={party.id} />
      </Suspense>
    ),
    purchases: () => (
      <Suspense fallback={<Skeleton className="h-48 w-full" />}>
        <SupplierPurchaseSummary partyId={party.id} />
      </Suspense>
    ),
    attachments: () => <PartyAttachments partyId={party.id} readOnly={!canEdit} />,
    history: () => <PartyHistory partyId={party.id} />,
  }

  return (
    <Tabs
      value={current}
      onValueChange={(value) =>
        setParams(
          (prev) => {
            const next = new URLSearchParams(prev)
            next.set('tab', value)
            return next
          },
          { replace: true },
        )
      }
    >
      <TabsList aria-label={t('detail.tabs')} className="flex-wrap">
        {tabs.map((tab) => (
          <TabsTrigger key={tab} value={tab}>
            {t(`detail.${tab}`)}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab} value={tab}>
          {current === tab ? panels[tab]() : null}
        </TabsContent>
      ))}
    </Tabs>
  )
}

function PartyAttachments({ partyId, readOnly }: { partyId: string; readOnly: boolean }) {
  const api = useMemo(() => partyFilesApi(partyId), [partyId])
  return <AttachmentPanel api={api} readOnly={readOnly} />
}

function PartyHistory({ partyId }: { partyId: string }) {
  const { t } = useTranslation('parties')
  const audit = usePartyAudit(partyId)
  const entries = audit.data?.pages.flatMap((p) => p.entries) ?? []
  const labels = useMemo(
    () => ({
      code: t('fields.code'),
      name: t('fields.name'),
      legal_name: t('fields.legal_name'),
      type: t('fields.type'),
      roles: t('fields.roles'),
      tax_office: t('fields.tax_office'),
      tax_number: t('fields.tax_number'),
      country: t('fields.country'),
      default_currency_code: t('fields.default_currency_code'),
      risk_limit: t('fields.risk_limit'),
      risk_currency_code: t('fields.risk_currency_code'),
      is_active: t('fields.is_active'),
      notes: t('fields.notes'),
      tags: t('fields.tags'),
    }),
    [t],
  )
  return (
    <AuditTrail
      entries={entries}
      loading={audit.isPending || audit.isFetchingNextPage}
      error={audit.isError}
      onRetry={() => void audit.refetch()}
      hasMore={audit.hasNextPage}
      onLoadMore={() => void audit.fetchNextPage()}
      fieldLabels={labels}
    />
  )
}
