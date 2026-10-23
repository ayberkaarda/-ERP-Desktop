import { useInfiniteQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toIsoDate } from '@/lib/datetime'
import { treasuryApi } from './api'
import { activeCompany, treasuryKey } from './keys'
import type { Page, Allocation, Area, Payment, TreasuryRecord } from './types'
import { Allocations } from '../payments/Allocations'
import { instrumentAllocationInput } from '../payments/lib'
import {
  AccountField,
  DateField,
  ErrorNotice,
  LedgerField,
  MoneyField,
  PartyField,
  SelectField,
  TextField,
} from './ui'
import { useAccounts, useTreasuryCompany, useTreasuryMutation, useTreasuryT } from './hooks'

export function ActionDialog({
  area,
  record,
  action,
  onClose,
  onDone,
  onReload,
}: {
  area: Area
  record: TreasuryRecord
  action: string
  onClose: () => void
  onDone: (record: TreasuryRecord | null) => void
  onReload: () => void
}) {
  const t = useTreasuryT()
  const company = useTreasuryCompany()
  const [date, setDate] = useState(() => toIsoDate(new Date()))
  const [reason, setReason] = useState('')
  const [account, setAccount] = useState('')
  const [party, setParty] = useState('')
  const [payment, setPayment] = useState('')
  const [amount, setAmount] = useState('')
  const [rate, setRate] = useState('1')
  const [offset, setOffset] = useState('')
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const accounts = useAccounts()
  const payments = useInfiniteQuery({
    queryKey: treasuryKey(company, 'fulfil-options', record.id),
    initialPageParam: 1,
    getNextPageParam: (last: Page<Payment>) =>
      last.meta.pagination.current_page < last.meta.pagination.last_page
        ? last.meta.pagination.current_page + 1
        : undefined,
    queryFn: ({ signal, pageParam }) =>
      treasuryApi.list<Payment>(
        'payments',
        {
          'filter[status]': 'posted',
          'filter[party_id]': 'party_id' in record ? record.party_id : undefined,
          'filter[direction]': 'direction' in record ? record.direction : undefined,
          'filter[currency_code]': 'currency_code' in record ? record.currency_code : undefined,
          'filter[account_id]':
            'account_id' in record ? (record.account_id ?? undefined) : undefined,
          page: pageParam,
          per_page: 25,
        },
        signal,
      ),
    enabled: action === 'fulfil',
  })
  const mutation = useTreasuryMutation<TreasuryRecord | null>(
    `${area}:${record.id}:${action}`,
    async (body, key) =>
      action === 'delete'
        ? treasuryApi.remove(area, record.id, record.version).then(() => null)
        : treasuryApi.action(area, record.id, action, body, key),
    onDone,
  )
  const needsReason = ['reverse', 'dishonour', 'return', 'reopen', 'opening-balance'].includes(
    action,
  )
  const needsDate =
    action === 'opening-balance' ||
    action === 'reverse' ||
    (area === 'instruments' &&
      [
        'receive',
        'issue',
        'endorse',
        'collect',
        'pledge',
        'release',
        'clear',
        'dishonour',
        'return',
      ].includes(action))
  const needsAccount = action === 'clear'
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose()
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t(action)}</DialogTitle>
          <DialogDescription>{t('confirmAction')}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            const body: Record<string, unknown> = { version: record.version }
            if (needsDate)
              body[action === 'reverse' && area !== 'instruments' ? 'date' : 'document_date'] = date
            if (reason.trim()) body.reason = reason.trim()
            if (needsAccount) body.account_id = account
            if (action === 'endorse') {
              body.party_id = party
              body.allocations = instrumentAllocationInput(allocations)
            }
            if (action === 'fulfil') body.payment_id = payment
            if (action === 'opening-balance') {
              body.amount = amount
              body.fx_rate = rate
              body.offset_account_id = offset
            }
            mutation.mutate({ body, company: activeCompany() })
          }}
        >
          <ErrorNotice error={mutation.error} reload={onReload} />
          {needsDate && <DateField name="document_date" value={date} onChange={setDate} />}
          {needsReason && <TextField name="reason" value={reason} onChange={setReason} required />}
          {needsAccount && (
            <>
              <ErrorNotice error={accounts.error} />
              <AccountField
                value={account}
                onChange={setAccount}
                accounts={accounts.data?.data ?? []}
              />
            </>
          )}
          {action === 'opening-balance' && (
            <>
              <MoneyField name="amount" value={amount} onChange={setAmount} />
              <MoneyField name="fx_rate" value={rate} onChange={setRate} scale={6} />
              <LedgerField name="offset_account_id" value={offset} onChange={setOffset} />
            </>
          )}
          {action === 'endorse' && (
            <>
              <PartyField
                value={party}
                onChange={(id) => {
                  setParty(id)
                  setAllocations([])
                }}
              />
              <Allocations
                partyId={party}
                direction="payment"
                value={allocations}
                onChange={setAllocations}
                currency={'currency_code' in record ? record.currency_code : undefined}
                showRate={false}
              />
            </>
          )}
          {action === 'fulfil' && (
            <>
              <ErrorNotice error={payments.error} />
              {payments.hasNextPage && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={payments.isFetchingNextPage}
                  onClick={() => void payments.fetchNextPage()}
                >
                  {t('next')}
                </Button>
              )}
              <SelectField
                name="payment_id"
                value={payment}
                onChange={setPayment}
                options={(payments.data?.pages.flatMap((page) => page.data) ?? [])
                  .filter(
                    (p) =>
                      p.party_id === ('party_id' in record ? record.party_id : '') &&
                      p.direction === ('direction' in record ? record.direction : '') &&
                      p.currency_code === ('currency_code' in record ? record.currency_code : ''),
                  )
                  .map((p) => ({
                    value: p.id,
                    label: `${p.number ?? p.reference ?? p.id} · ${p.amount} ${p.currency_code}`,
                  }))}
              />
            </>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={mutation.isPending}
              onClick={onClose}
            >
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              disabled={
                mutation.isPending ||
                (needsReason && !reason.trim()) ||
                (needsAccount && !account) ||
                (action === 'opening-balance' && (!amount || !offset)) ||
                (action === 'endorse' && !party) ||
                (action === 'fulfil' && !payment)
              }
            >
              {mutation.isPending ? t('loading') : t('confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
