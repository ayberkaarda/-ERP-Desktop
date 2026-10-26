import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AttachmentPanel, createFilesApi } from '@/components/shared/attachments'
import { AuditTrail, type AuditEntry } from '@/components/shared/AuditTrail'
import { PageHeader } from '@/components/shared/PageHeader'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { PURCH_PATHS } from '../lib/chain'
import type { PurchaseKind, PurchaseLink } from '../types'
import { Facts, PurchStatusBadge } from './common'
import { DocumentChain } from './DocumentChain'

export interface ViewTab {
  value: string
  label: string
  content: ReactNode
}

const TYPE = { request: 'purchase_request', rfq: 'purchase_rfq', order: 'purchase_order' } as const
const PLURAL = { request: 'requests', rfq: 'rfqs', order: 'orders' } as const

interface DocumentViewProps {
  kind: PurchaseKind
  document: {
    id: string
    number: string | null
    status: string
    document_date: string
    total?: string | null
    estimated_total?: string | null
    currency_code: string
    links: PurchaseLink[]
    audit: AuditEntry[]
  }
  facts: [string, ReactNode][]
  actions?: ReactNode
  /** Notices above the facts (approval state, rejection comment). */
  banner?: ReactNode
  /** The first tab (lines) and any extra tabs; audit and attachments are added. */
  tabs: ViewTab[]
  /** Permission to add attachments (the document's update). */
  attachPermission: string
}

/** Read-only request, RFQ or order: header, facts, document chain, tabs, audit, attachments. */
export function DocumentView({
  kind,
  document: doc,
  facts,
  actions,
  banner,
  tabs,
  attachPermission,
}: DocumentViewProps) {
  const { t } = useTranslation('purchasing-orders')
  const canAttach = usePermission(attachPermission)
  const files = useMemo(
    () => createFilesApi(platform.http, { type: TYPE[kind], id: doc.id }),
    [kind, doc.id],
  )
  const number = doc.number ?? t('common.unnumbered')
  return (
    <div className="mx-auto max-w-[1440px] space-y-5 px-6 py-6">
      <PageHeader
        title={t(`${PLURAL[kind]}.viewTitle`, { number })}
        breadcrumbs={[
          { label: t('nav.purchasing') },
          { label: t(`nav.${PLURAL[kind]}`), to: PURCH_PATHS[kind] },
          { label: number },
        ]}
        meta={<PurchStatusBadge kind={kind} status={doc.status} />}
        actions={actions}
      />
      {banner}
      <Facts items={facts} />
      <section aria-label={t('chain.title')} className="space-y-2">
        <h2 className="text-sm font-semibold">{t('chain.title')}</h2>
        <DocumentChain
          current={{
            type: TYPE[kind],
            id: doc.id,
            number: doc.number,
            status: doc.status,
            document_date: doc.document_date,
            total: doc.total ?? doc.estimated_total ?? null,
            currency_code: doc.currency_code,
          }}
          links={doc.links}
        />
      </section>
      <Tabs defaultValue={tabs[0]?.value ?? 'audit'}>
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
          <TabsTrigger value="audit">{t('view.audit')}</TabsTrigger>
          <TabsTrigger value="attachments">{t('view.attachments')}</TabsTrigger>
        </TabsList>
        {tabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value} className="space-y-4">
            {tab.content}
          </TabsContent>
        ))}
        <TabsContent value="audit">
          <AuditTrail entries={doc.audit} />
        </TabsContent>
        <TabsContent value="attachments">
          <AttachmentPanel api={files} readOnly={!canAttach} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
