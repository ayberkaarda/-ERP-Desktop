import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { usePermission } from '@/lib/permissions'
import { edocumentsApi } from './api'
import { useEdocScope, useEdocT, useOperation } from './hooks'
import { KINDS, STATUSES, type Direction, type Kind } from './types'
import { Amount, control, ErrorNotice, Field, Header, Pagination, Panel, StatusBadge } from './ui'
export function ListPage({ direction }: { direction: Direction }) {
  const t = useEdocT()
  const scope = useEdocScope()
  const client = useQueryClient()
  const navigate = useNavigate()
  const operation = useOperation()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [kind, setKind] = useState<Kind | ''>('')
  const [status, setStatus] = useState('')
  const [xml, setXml] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [pollCount, setPollCount] = useState<number | null>(null)
  const [pollErrors, setPollErrors] = useState<{ id: string; message: string }[]>([])
  const [staged, setStaged] = useState(false)
  const create = usePermission('edocuments.create')
  const importAllowed = usePermission('edocuments.import')
  const manage = usePermission('edocuments.manage')
  const query = useQuery({
    queryKey: ['edocuments', scope.key, 'list', direction, search, kind, status, page],
    queryFn: ({ signal }) =>
      edocumentsApi.list(
        { direction, search, kind: kind || undefined, status: status || undefined, page },
        signal,
      ),
    enabled: scope.enabled,
  })
  const imported = (record: { id: string }) => {
    void client.invalidateQueries({ queryKey: ['edocuments', scope.key] })
    void navigate(`/edocuments/documents/${record.id}`)
  }
  return (
    <>
      <Header
        title={t(direction === 'outgoing' ? 'outbox' : 'inbox')}
        actions={
          <>
            {direction === 'outgoing' && create && (
              <Button asChild>
                <Link to="/edocuments/outbox/new">{t('new')}</Link>
              </Button>
            )}
            {direction === 'incoming' && importAllowed && (
              <>
                <Button
                  variant="secondary"
                  disabled={operation.busy}
                  onClick={() =>
                    void operation.run(
                      ['poll-inbox'],
                      (key, signal) => edocumentsApi.pollInbox(key, signal),
                      (value) => {
                        setPollCount(value.imported)
                        setPollErrors(value.errors ?? [])
                        setStaged(false)
                        void query.refetch()
                      },
                    )
                  }
                >
                  {t('pollInbox')}
                </Button>
                <Button onClick={() => setImportOpen((value) => !value)}>{t('importXml')}</Button>
              </>
            )}
          </>
        }
      />
      <ErrorNotice error={operation.error} reload={() => void query.refetch()} />
      {staged && (
        <p role="status" className="text-sm">
          {t('staged')}
        </p>
      )}
      {pollErrors.length > 0 && (
        <ul
          role="alert"
          className="space-y-2 rounded-md bg-danger-soft p-3 text-sm text-danger-soft-foreground"
        >
          {pollErrors.map((issue) => (
            <li key={issue.id}>
              {issue.message} <span className="font-mono text-xs">({issue.id.slice(0, 8)})</span>
            </li>
          ))}
        </ul>
      )}
      {pollCount !== null && (
        <p role="status" className="text-sm">
          {t('importCount', { count: pollCount })}
        </p>
      )}
      {importOpen && direction === 'incoming' && importAllowed && (
        <Panel>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault()
              void operation.run(
                ['import', xml],
                (key, signal) => edocumentsApi.importXml(xml, key, signal),
                imported,
              )
            }}
          >
            <Field label={t('xmlContent')}>
              <textarea
                className={`${control} h-52 font-mono text-xs`}
                rows={10}
                maxLength={1_048_576}
                value={xml}
                onChange={(event) => setXml(event.target.value)}
                disabled={operation.busy}
                required
              />
            </Field>
            <p className="text-xs text-muted-foreground">{t('importHelp')}</p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={operation.busy || !xml.trim()} type="submit">
                {t('importXml')}
              </Button>
              {manage && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={operation.busy || !xml.trim()}
                  onClick={() =>
                    void operation.run(
                      ['stage', xml],
                      (key, signal) => edocumentsApi.stage(xml, key, signal),
                      () => {
                        setXml('')
                        setPollCount(null)
                        setPollErrors([])
                        setStaged(true)
                        setImportOpen(false)
                      },
                    )
                  }
                >
                  {t('stageInbox')}
                </Button>
              )}
            </div>
          </form>
        </Panel>
      )}
      <Panel>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('search')}>
            <input
              className={control}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
          </Field>
          <Field label={t('kind')}>
            <select
              className={control}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as Kind | '')
                setPage(1)
              }}
            >
              <option value="">{t('all')}</option>
              {KINDS.map((value) => (
                <option key={value} value={value}>
                  {t(value)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('status')}>
            <select
              className={control}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value)
                setPage(1)
              }}
            >
              <option value="">{t('all')}</option>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`status_${value}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <ErrorNotice error={query.error} reload={() => void query.refetch()} />
        {query.isPending ? (
          <p role="status">{t('loading')}</p>
        ) : (
          query.data && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">
                    {t(direction === 'outgoing' ? 'outbox' : 'inbox')}
                  </caption>
                  <thead className="border-b border-border text-xs text-muted-foreground">
                    <tr>
                      {['number', 'documentDate', 'party', 'kind', 'total', 'status'].map((key) => (
                        <th key={key} className="whitespace-nowrap p-3">
                          {t(key)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.data.map((record) => (
                      <tr key={record.id} className="border-b border-border">
                        <td className="p-3">
                          <Link
                            className="font-mono text-primary hover:underline"
                            to={`/edocuments/documents/${record.id}`}
                          >
                            {record.number ?? t('unnumbered')}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap p-3">{record.document_date}</td>
                        <td className="p-3">{record.party_name}</td>
                        <td className="p-3">{t(record.kind)}</td>
                        <td className="p-3">
                          {record.kind === 'e_despatch' ? (
                            <span aria-label={t('notApplicable')}>—</span>
                          ) : (
                            <Amount value={record.total} currency={record.currency_code} />
                          )}
                        </td>
                        <td className="p-3">
                          <StatusBadge status={record.status} />
                        </td>
                      </tr>
                    ))}
                    {query.data.data.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-muted-foreground">
                          {t('empty')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <Pagination data={query.data} page={page} setPage={setPage} busy={query.isFetching} />
            </>
          )
        )}
      </Panel>
    </>
  )
}
