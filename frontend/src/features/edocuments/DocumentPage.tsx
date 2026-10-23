import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { usePermission } from '@/lib/permissions'
import { edocumentsApi } from './api'
import { useEdocScope, useEdocT, useOperation } from './hooks'
import { Amount, control, ErrorNotice, Field, Header, Pagination, Panel, StatusBadge } from './ui'
import type { EDocument } from './types'
import { MetadataEdit } from './MetadataEdit'
import { SnapshotSheet } from './SnapshotSheet'

function JsonPreview({ value }: { value: unknown }) {
  const t = useEdocT()
  return (
    <details>
      <summary className="cursor-pointer text-sm font-medium">{t('snapshot')}</summary>
      <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-sunken p-3 font-mono text-xs">
        {JSON.stringify(value, null, 2).slice(0, 262_144)}
      </pre>
    </details>
  )
}
export function DocumentPage() {
  const { id = '' } = useParams()
  const t = useEdocT()
  const scope = useEdocScope()
  const client = useQueryClient()
  const operation = useOperation()
  const [reason, setReason] = useState('')
  const [purchaseSearch, setPurchaseSearch] = useState('')
  const [purchasePage, setPurchasePage] = useState(1)
  const [purchase, setPurchase] = useState('')
  const [outcome, setOutcome] = useState('delivered')
  const [showLink, setShowLink] = useState(false)
  const canValidate = usePermission('edocuments.validate')
  const canSend = usePermission('edocuments.send')
  const canRespond = usePermission('edocuments.respond')
  const canManage = usePermission('edocuments.manage')
  const canLink = usePermission(['edocuments.import', 'purchasing.invoices.view'])
  const canEdit = usePermission('edocuments.create')
  const query = useQuery({
    queryKey: ['edocuments', scope.key, 'detail', id],
    queryFn: ({ signal }) => edocumentsApi.get(id, signal),
    enabled: scope.enabled && !!id,
  })
  const provider = useQuery({
    queryKey: ['edocuments', scope.key, 'status'],
    queryFn: ({ signal }) => edocumentsApi.status(signal),
    enabled: scope.enabled,
    retry: false,
  })
  const purchaseOptions = useQuery({
    queryKey: ['edocuments', scope.key, 'purchase-options', purchaseSearch, purchasePage],
    queryFn: ({ signal }) => edocumentsApi.purchaseInvoices(purchaseSearch, purchasePage, signal),
    enabled: scope.enabled && canLink && showLink,
    retry: false,
  })
  const record = query.data
  const saved = (value: EDocument) => {
    client.setQueryData(['edocuments', scope.key, 'detail', id], value)
    void client.invalidateQueries({ queryKey: ['edocuments', scope.key, 'list'] })
    setShowLink(false)
  }
  const act = (
    action: 'validate' | 'send' | 'retry' | 'poll' | 'respond' | 'link-purchase' | 'cancel',
    extra: Record<string, unknown> = {},
  ) =>
    record
      ? operation.run(
          [id, action, record.version, extra],
          (key, signal) =>
            edocumentsApi.action(id, action, { version: record.version, ...extra }, key, signal),
          saved,
        )
      : Promise.resolve()
  async function download() {
    await operation.run(
      [id, 'xml'],
      (_key, signal) => edocumentsApi.xml(id, signal),
      (value) => {
        const url = URL.createObjectURL(value.blob)
        const link = document.createElement('a')
        link.href = url
        link.download = (value.filename ?? `${record?.number ?? id}.xml`).replace(/[\\/]/g, '_')
        document.body.append(link)
        link.click()
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      },
    )
  }
  if (query.isPending) return <p role="status">{t('loading')}</p>
  if (!record) return <ErrorNotice error={query.error} reload={() => void query.refetch()} />
  const outgoing = record.direction === 'outgoing'
  const editable = ['draft', 'invalid', 'ready'].includes(record.status)
  const respondable =
    !outgoing && record.profile === 'TICARIFATURA' && record.status === 'delivered'
  const sourceUrl =
    record.source_type === 'delivery'
      ? `/sales/deliveries/${record.source_id}`
      : `/sales/invoices/${record.source_id}`
  return (
    <>
      <Header
        title={record.number ?? t('unnumbered')}
        actions={
          <>
            <Button
              variant="secondary"
              disabled={operation.busy}
              onClick={() => void query.refetch()}
            >
              {t('reload')}
            </Button>
            <Button variant="secondary" disabled={operation.busy} onClick={() => void download()}>
              {t('downloadXml')}
            </Button>
            {outgoing && canValidate && editable && (
              <Button
                variant="secondary"
                disabled={operation.busy}
                onClick={() => void act('validate')}
              >
                {t('validate')}
              </Button>
            )}
            {outgoing && canSend && record.status === 'ready' && (
              <ConfirmDialog
                title={t('send')}
                description={t('sendConfirm')}
                confirmLabel={t('send')}
                tone="primary"
                trigger={
                  <Button
                    disabled={
                      operation.busy ||
                      !provider.data?.available ||
                      !provider.data.validation_available ||
                      !record.validation?.available ||
                      !record.validation.valid
                    }
                  >
                    {t('send')}
                  </Button>
                }
                onConfirm={() => act('send')}
              />
            )}
            {outgoing && canSend && ['sending', 'failed'].includes(record.status) && (
              <Button disabled={operation.busy} onClick={() => void act('retry')}>
                {t('retrySend')}
              </Button>
            )}
            {canSend && outgoing && ['sent', 'delivered'].includes(record.status) && (
              <Button
                disabled={operation.busy}
                variant="secondary"
                onClick={() => void act('poll')}
              >
                {t('pollStatus')}
              </Button>
            )}
          </>
        }
      />
      <ErrorNotice error={operation.error} reload={() => void query.refetch()} />
      <Panel>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={record.status} />
          <span className="text-sm">
            {t(record.kind)} · {record.profile}
          </span>
        </div>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            [t('uuid'), record.uuid],
            [t('documentDate'), record.document_date],
            [t('party'), record.party_name],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="break-all text-sm">{value}</dd>
            </div>
          ))}
          <div>
            <dt className="text-xs text-muted-foreground">{t('total')}</dt>
            <dd>
              {record.kind === 'e_despatch' ? (
                <span aria-label={t('notApplicable')}>—</span>
              ) : (
                <Amount value={record.total} currency={record.currency_code} />
              )}
            </dd>
          </div>
          {record.source_id && (
            <div>
              <dt className="text-xs text-muted-foreground">{t('source')}</dt>
              <dd>
                <Link className="text-sm text-primary underline" to={sourceUrl}>
                  {record.source_number ?? t('source')}
                </Link>
              </dd>
            </div>
          )}
          {record.purchase_invoice_id && (
            <div>
              <dt className="text-xs text-muted-foreground">{t('purchaseInvoice')}</dt>
              <dd>
                <Link
                  className="text-sm text-primary underline"
                  to={`/purchasing/invoices/${record.purchase_invoice_id}`}
                >
                  {t('openPurchase')}
                </Link>
              </dd>
            </div>
          )}
        </dl>
      </Panel>
      <Panel>
        <h2 className="text-sm font-semibold">{t('validation')}</h2>
        <p className="text-xs text-muted-foreground">{t('signatureDisclaimer')}</p>
        {!record.validation ? (
          <p className="text-sm text-muted-foreground">{t('notValidated')}</p>
        ) : (
          <>
            <p className="text-sm">
              {!record.validation.available
                ? t('validatorUnavailable')
                : record.validation.valid
                  ? t('valid')
                  : t('invalid')}
            </p>
            {record.validation.schema_version && (
              <p className="text-xs text-muted-foreground">{record.validation.schema_version}</p>
            )}
            <ul className="space-y-2">
              {record.validation.errors.map((issue, i) => (
                <li
                  key={i}
                  className="rounded bg-danger-soft p-2 text-sm text-danger-soft-foreground"
                >
                  <span className="font-mono text-xs">
                    {issue.code}
                    {issue.path ? ` · ${issue.path}` : ''}
                  </span>
                  <p>{issue.message}</p>
                </li>
              ))}
            </ul>
            {record.validation.warnings.map((issue, i) => (
              <p key={i} className="text-sm text-warning">
                {typeof issue === 'string' ? issue : issue.message}
              </p>
            ))}
          </>
        )}
      </Panel>
      {respondable && canRespond && (
        <Panel>
          <h2 className="text-sm font-semibold">{t('respond')}</h2>
          <Field label={t('reason')}>
            <input
              className={control}
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            {(['accept', 'reject'] as const).map((decision) => (
              <ConfirmDialog
                key={decision}
                title={t(decision)}
                description={t('respondConfirm')}
                confirmLabel={t(decision)}
                tone={decision === 'reject' ? 'danger' : 'primary'}
                trigger={
                  <Button
                    disabled={operation.busy || (decision === 'reject' && !reason.trim())}
                    variant={decision === 'reject' ? 'secondary' : 'primary'}
                  >
                    {t(decision)}
                  </Button>
                }
                onConfirm={() =>
                  act('respond', { decision, ...(reason.trim() ? { reason: reason.trim() } : {}) })
                }
              />
            ))}
          </div>
        </Panel>
      )}
      {!outgoing && record.kind !== 'e_despatch' && canLink && !record.purchase_invoice_id && (
        <Panel>
          <Button variant="secondary" onClick={() => setShowLink((value) => !value)}>
            {t('linkPurchase')}
          </Button>
          {showLink && (
            <>
              <p className="text-xs text-muted-foreground">{t('linkHelp')}</p>
              <Field label={t('search')}>
                <input
                  className={control}
                  value={purchaseSearch}
                  onChange={(event) => {
                    setPurchaseSearch(event.target.value)
                    setPurchasePage(1)
                    setPurchase('')
                  }}
                />
              </Field>
              <ErrorNotice error={purchaseOptions.error} />
              <Field label={t('purchaseInvoice')}>
                <select
                  className={control}
                  value={purchase}
                  onChange={(event) => setPurchase(event.target.value)}
                >
                  <option value="">{t('choose')}</option>
                  {purchaseOptions.data?.data.map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>
                      {invoice.number ?? t('unnumbered')} · {invoice.party_name} · {invoice.total}{' '}
                      {invoice.currency_code}
                    </option>
                  ))}
                </select>
              </Field>
              <Pagination
                data={purchaseOptions.data}
                page={purchasePage}
                setPage={(value) => {
                  setPurchasePage(value)
                  setPurchase('')
                }}
                busy={purchaseOptions.isFetching}
              />
              <Button
                disabled={!purchase || operation.busy}
                onClick={() => void act('link-purchase', { purchase_invoice_id: purchase })}
              >
                {t('linkPurchase')}
              </Button>
            </>
          )}
        </Panel>
      )}
      {outgoing && canEdit && ['draft', 'invalid'].includes(record.status) && !record.number && (
        <Panel>
          <details>
            <summary className="cursor-pointer text-sm font-semibold">{t('editMetadata')}</summary>
            <div className="mt-4">
              <MetadataEdit key={record.version} record={record} onSaved={saved} />
            </div>
          </details>
        </Panel>
      )}
      <Panel>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{t('preview')}</h2>
          <Button variant="secondary" size="sm" asChild>
            <Link to={`/edocuments/documents/${id}/print`}>{t('print')}</Link>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t('previewHelp')}</p>
        <SnapshotSheet record={record} />
        <JsonPreview value={record.snapshot ?? {}} />
      </Panel>
      {canManage && outgoing && ['sending', 'sent', 'delivered'].includes(record.status) && (
        <Panel>
          <h2 className="text-sm font-semibold">{t('simulation')}</h2>
          <p className="text-xs text-muted-foreground">{t('simulationHelp')}</p>
          <Field label={t('outcome')}>
            <select
              className={control}
              value={outcome}
              onChange={(event) => setOutcome(event.target.value)}
            >
              {['delivered', 'accepted', 'rejected', 'failed'].map((value) => (
                <option key={value} value={value}>
                  {t(`status_${value}`)}
                </option>
              ))}
            </select>
          </Field>
          <Button
            disabled={operation.busy}
            variant="secondary"
            onClick={() =>
              void operation.run(
                [id, 'outcome', outcome],
                (key, signal) => edocumentsApi.outcome(id, outcome, record.version, key, signal),
                saved,
              )
            }
          >
            {t('applyOutcome')}
          </Button>
        </Panel>
      )}
      {outgoing && editable && canEdit && (
        <Panel>
          <h2 className="text-sm font-semibold">{t('cancelLocal')}</h2>
          <Field label={t('cancelReason')}>
            <input
              className={control}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={1000}
              disabled={operation.busy}
              required
            />
          </Field>
          <ConfirmDialog
            title={t('cancelLocal')}
            description={t('cancelConfirm')}
            confirmLabel={t('cancelLocal')}
            trigger={
              <Button variant="secondary" disabled={operation.busy || !reason.trim()}>
                {t('cancelLocal')}
              </Button>
            }
            onConfirm={() => act('cancel', { reason: reason.trim() })}
          />
        </Panel>
      )}
      <Panel>
        <h2 className="text-sm font-semibold">{t('events')}</h2>
        {record.events?.length ? (
          <ol className="space-y-3">
            {record.events.map((event) => (
              <li key={event.id} className="border-l-2 border-border pl-3 text-sm">
                <time className="text-xs text-muted-foreground">{event.created_at}</time>
                <p>{event.message || event.event}</p>
                <p className="text-xs text-muted-foreground">
                  {event.from_status ? `${t(`status_${event.from_status}`)} → ` : ''}
                  {t(`status_${event.to_status}`)}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        )}
      </Panel>
    </>
  )
}
