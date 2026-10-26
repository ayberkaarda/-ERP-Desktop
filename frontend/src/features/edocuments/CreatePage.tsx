import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { usePermission } from '@/lib/permissions'
import { edocumentsApi } from './api'
import { useEdocScope, useEdocT, useOperation } from './hooks'
import { MetadataFields } from './MetadataFields'
import { buildMetadata, type MetadataValues } from './metadata'
import { KINDS, PROFILES, type Kind } from './types'
import { control, ErrorNotice, Field, Header, Pagination, Panel } from './ui'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function CreatePage() {
  const t = useEdocT()
  const scope = useEdocScope()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const operation = useOperation()
  const initialKind = KINDS.find((kind) => kind === params.get('kind')) ?? 'e_invoice'
  const initialId = params.get('source_id') ?? ''
  const [kind, setKind] = useState<Kind>(initialKind)
  const [profile, setProfile] = useState(PROFILES[initialKind][0])
  const [series, setSeries] = useState('ABC')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [source, setSource] = useState(uuid.test(initialId) ? initialId : '')
  const [metadata, setMetadata] = useState<MetadataValues>({})
  const canInvoices = usePermission('sales.invoices.view')
  const canDeliveries = usePermission('sales.deliveries.view')
  const allowed = kind === 'e_despatch' ? canDeliveries : canInvoices
  const sources = useQuery({
    queryKey: ['edocuments', scope.key, 'sources', kind, search, page],
    queryFn: ({ signal }) => edocumentsApi.sources(kind, search, page, signal),
    enabled: scope.enabled && allowed,
    retry: false,
  })
  const included = sources.data?.data.some((item) => item.id === source)
  return (
    <>
      <Header title={t('new')} />
      <Panel>
        <p className="text-sm text-muted-foreground">{t('createHelp')}</p>
        <ErrorNotice error={operation.error} />
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault()
            const body = {
              source_id: source,
              kind,
              profile,
              series,
              metadata: buildMetadata(metadata),
            }
            void operation.run(
              ['create', body],
              (key, signal) => edocumentsApi.create(body, key, signal),
              (record) => {
                void navigate(`/edocuments/documents/${record.id}`)
              },
            )
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('kind')}>
              <select
                className={control}
                value={kind}
                disabled={operation.busy}
                onChange={(event) => {
                  const next = event.target.value as Kind
                  setKind(next)
                  setProfile(PROFILES[next][0])
                  setSource('')
                  setPage(1)
                  setMetadata({})
                }}
              >
                {KINDS.map((value) => (
                  <option key={value} value={value}>
                    {t(value)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('profile')}>
              <select
                className={control}
                value={profile}
                disabled={operation.busy}
                onChange={(event) => setProfile(event.target.value)}
              >
                {PROFILES[kind].map((value) => (
                  <option key={value} value={value}>
                    {t(`profile_${value}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('series')}>
              <input
                className={control}
                value={series}
                onChange={(event) => setSeries(event.target.value.toUpperCase())}
                pattern="[A-Z]{3}"
                maxLength={3}
                required
                disabled={operation.busy}
              />
            </Field>
          </div>
          {!allowed ? (
            <p role="alert" className="text-sm text-danger">
              {t('sourcePermission')}
            </p>
          ) : (
            <>
              <Field label={t('sourceSearch')}>
                <input
                  className={control}
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value)
                    setPage(1)
                  }}
                  disabled={operation.busy}
                />
              </Field>
              <ErrorNotice error={sources.error} reload={() => void sources.refetch()} />
              <Field label={t('source')}>
                <select
                  className={control}
                  value={source}
                  required
                  disabled={operation.busy || sources.isFetching}
                  onChange={(event) => setSource(event.target.value)}
                >
                  <option value="">{t('choose')}</option>
                  {source && !included && (
                    <option value={source}>
                      {params.get('source_number') ??
                        `${t('selectedSource')} · ${source.slice(0, 8)}`}
                    </option>
                  )}
                  {sources.data?.data.map((value) => (
                    <option key={value.id} value={value.id}>
                      {value.number} · {value.party_name} · {value.document_date} · {value.total}{' '}
                      {value.currency_code}
                    </option>
                  ))}
                </select>
              </Field>
              <Pagination
                data={sources.data}
                page={page}
                setPage={setPage}
                busy={sources.isFetching || operation.busy}
              />
            </>
          )}
          <MetadataFields
            kind={kind}
            profile={profile}
            values={metadata}
            onChange={setMetadata}
            disabled={operation.busy}
          />
          <Button type="submit" disabled={operation.busy || !source || !allowed}>
            {t('create')}
          </Button>
        </form>
      </Panel>
    </>
  )
}
