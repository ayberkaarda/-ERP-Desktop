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
import { usePermission } from '@/lib/permissions'
import { treasuryApi } from '../shared/api'
import { activeCompany, treasuryKey } from '../shared/keys'
import type { Page, MatchSuggestion, Statement, StatementLine } from '../shared/types'
import { ErrorNotice, Panel, SelectField } from '../shared/ui'
import { useTreasuryCompany, useTreasuryMutation, useTreasuryT } from '../shared/hooks'
import { StatementLines } from './StatementImport'

export function StatementDetail({
  record,
  onSaved,
}: {
  record: Statement
  onSaved: (record: Statement) => void
}) {
  const t = useTreasuryT()
  const canMatch = usePermission('treasury.banking.reconcile')
  const [line, setLine] = useState<StatementLine | null>(null)
  const mutation = useTreasuryMutation<Statement>(
    `banking:${record.id}:unmatch`,
    (body, key) => treasuryApi.action('banking', record.id, 'unmatch', body, key),
    onSaved,
  )
  return (
    <Panel title={t('movements')}>
      <ErrorNotice error={mutation.error} />
      <StatementLines
        lines={record.lines}
        currency={record.currency_code}
        action={
          canMatch && record.status !== 'reconciled'
            ? (selected) => (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={mutation.isPending}
                  onClick={() =>
                    selected.matched || selected.movement_id || selected.payment_id
                      ? mutation.mutate({
                          body: { version: record.version, line_id: selected.id },
                          company: activeCompany(),
                        })
                      : setLine(selected)
                  }
                >
                  {t(
                    selected.matched || selected.movement_id || selected.payment_id
                      ? 'unmatch'
                      : 'match',
                  )}
                </Button>
              )
            : undefined
        }
      />
      {line && (
        <MatchDialog
          record={record}
          line={line}
          onClose={() => setLine(null)}
          onSaved={(result) => {
            onSaved(result)
            setLine(null)
          }}
        />
      )}
    </Panel>
  )
}
function MatchDialog({
  record,
  line,
  onClose,
  onSaved,
}: {
  record: Statement
  line: StatementLine
  onClose: () => void
  onSaved: (record: Statement) => void
}) {
  const t = useTreasuryT()
  const company = useTreasuryCompany()
  const [payment, setPayment] = useState('')
  const suggestions = useInfiniteQuery({
    queryKey: treasuryKey(company, 'statement-suggestions', record.id, line.id),
    initialPageParam: 1,
    getNextPageParam: (last: Page<MatchSuggestion>) =>
      last.meta.pagination.current_page < last.meta.pagination.last_page
        ? last.meta.pagination.current_page + 1
        : undefined,
    queryFn: ({ signal, pageParam }) =>
      treasuryApi.suggestions(record.id, line.id, pageParam, signal),
  })
  const mutation = useTreasuryMutation<Statement>(
    `banking:${record.id}:match:${line.id}`,
    (body, key) => treasuryApi.action('banking', record.id, 'match', body, key),
    onSaved,
  )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('match')}</DialogTitle>
          <DialogDescription>{t('matchHelp')}</DialogDescription>
        </DialogHeader>
        <ErrorNotice error={suggestions.error ?? mutation.error} />
        <SelectField
          name="payment_id"
          value={payment}
          onChange={setPayment}
          options={(suggestions.data?.pages.flatMap((page) => page.data) ?? []).map((p) => ({
            value: p.id,
            label: `${p.reference ?? p.id} · ${p.document_date} · ${p.amount} ${p.currency_code}`,
          }))}
        />
        {suggestions.hasNextPage && (
          <Button
            variant="secondary"
            disabled={suggestions.isFetchingNextPage}
            onClick={() => void suggestions.fetchNextPage()}
          >
            {t('next')}
          </Button>
        )}
        <DialogFooter>
          <Button variant="secondary" disabled={mutation.isPending} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            disabled={!payment || mutation.isPending}
            onClick={() =>
              mutation.mutate({
                body: { version: record.version, line_id: line.id, movement_id: payment },
                company: activeCompany(),
              })
            }
          >
            {mutation.isPending ? t('loading') : t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
