import { scalar } from './format'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePermission } from '@/lib/permissions'
import { treasuryApi } from './api'
import { treasuryKey } from './keys'
import { permission, type Area, type TreasuryRecord } from './types'
import { Amount, ErrorNotice, Loading, Panel, Status, TreasuryHeader } from './ui'
import { useTreasuryCompany, useTreasuryT } from './hooks'

function cells(record: TreasuryRecord) {
  const row = record as unknown as Record<string, unknown>
  return {
    label: scalar(row.code ?? row.number ?? row.instrument_number ?? row.bank_reference ?? row.id),
    date: scalar(row.document_date ?? row.due_date ?? row.end_date ?? ''),
    name: scalar(row.name ?? row.party_name ?? row.reference ?? row.description ?? ''),
    amount: scalar(row.amount ?? row.balance ?? row.closing_balance ?? '0'),
    currency: scalar(row.currency_code ?? ''),
    status: scalar(row.status ?? (row.is_active === true ? 'is_active' : '')),
  }
}
export function ListPage({ area }: { area: Area }) {
  const company = useTreasuryCompany()
  return <ListContent key={company} area={area} />
}
function ListContent({ area }: { area: Area }) {
  const t = useTreasuryT()
  const company = useTreasuryCompany()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const canCreate = usePermission(
    area === 'accounts'
      ? 'treasury.accounts.manage'
      : permission(area, area === 'banking' ? 'import' : 'create'),
  )
  const params = {
    q,
    page,
    per_page: 25,
    [area === 'banking' || area === 'instruments' ? 'status' : 'filter[status]']:
      status || undefined,
  }
  const list = useQuery({
    queryKey: treasuryKey(company, area, 'list', params),
    queryFn: ({ signal }) => treasuryApi.list(area, params, signal),
    placeholderData: keepPreviousData,
  })
  const paging = list.data?.meta.pagination
  return (
    <>
      <TreasuryHeader area={area}>
        {canCreate && (
          <Button asChild>
            <Link to={`/treasury/${area}/new`}>{t('new')}</Link>
          </Button>
        )}
      </TreasuryHeader>
      <Panel>
        <div className="mb-4 flex flex-wrap gap-3">
          <Input
            className="max-w-sm"
            aria-label={t('search')}
            placeholder={t('search')}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
          />
          {area !== 'accounts' && (
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              aria-label={t('status')}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value)
                setPage(1)
              }}
            >
              <option value="">{t('status')}</option>
              {(area === 'banking'
                ? ['imported', 'reconciled']
                : area === 'instruments'
                  ? [
                      'draft',
                      'portfolio',
                      'issued',
                      'collection',
                      'pledged',
                      'cleared',
                      'endorsed',
                      'dishonoured',
                      'returned',
                    ]
                  : area === 'plans'
                    ? ['scheduled', 'fulfilled', 'cancelled']
                    : [
                        'draft',
                        'pending_approval',
                        'approved',
                        'posted',
                        'portfolio',
                        'issued',
                        'cleared',
                        'reversed',
                        'cancelled',
                      ]
              ).map((s) => (
                <option key={s} value={s}>
                  {t(s)}
                </option>
              ))}
            </select>
          )}
        </div>
        <ErrorNotice error={list.error} reload={() => void list.refetch()} />
        {list.isPending ? (
          <Loading />
        ) : list.data?.data.length === 0 ? (
          <p className="py-12 text-center text-muted-foreground">{t('empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-y border-border bg-surface-sunken">
                <tr>
                  {['number', 'name', 'date', 'status', 'amount'].map((label) => (
                    <th key={label} className="p-3">
                      {t(label)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.data?.data.map((record) => {
                  const r = cells(record)
                  return (
                    <tr key={record.id} className="border-b border-border">
                      <td className="p-3 font-code">
                        <Link
                          className="text-primary hover:underline"
                          to={`/treasury/${area}/${record.id}`}
                        >
                          {r.label || t('unnumbered')}
                        </Link>
                      </td>
                      <td className="p-3">{r.name}</td>
                      <td className="p-3">{r.date}</td>
                      <td className="p-3">
                        <Status value={r.status} />
                      </td>
                      <td className="p-3">
                        <Amount value={r.amount} currency={r.currency} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {paging && (
          <div className="mt-4 flex items-center justify-between gap-3 text-sm">
            <span>{t('page', { page: paging.current_page, total: paging.last_page })}</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={page <= 1 || list.isFetching}
                onClick={() => setPage(page - 1)}
              >
                {t('previous')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={page >= paging.last_page || list.isFetching}
                onClick={() => setPage(page + 1)}
              >
                {t('next')}
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </>
  )
}
