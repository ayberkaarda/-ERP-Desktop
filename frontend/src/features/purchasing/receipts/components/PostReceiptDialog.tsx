import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, PackageCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ActionError } from '@/features/sales/invoices/kit/components/ActionError'
import { qty } from '@/features/sales/invoices/kit/money'
import { VersionConflictAlert } from '@/features/sales/shared/components/common'
import { useIntlLocale } from '@/lib/datetime'
import { isVersionConflict } from '../../invoices/kit/http'
import { activeCompany, invalidatePurchEffects, purchKeys } from '../../invoices/kit/keys'
import { receiptsApi } from '../api'
import { postKeys } from '../lib/postKeys'
import type { Receipt } from '../types'

interface PostReceiptDialogProps {
  receipt: Receipt
  open: boolean
  onOpenChange: (open: boolean) => void
  onPosted: (receipt: Receipt) => void
  onReload: () => void
}

/**
 * POST /purchase-receipts/{id}/post {version}: numbers the receipt (GRN), receives the stock at
 * the order cost and books Dr inventory / Cr goods received not invoiced.
 */
export function PostReceiptDialog({
  receipt,
  open,
  onOpenChange,
  onPosted,
  onReload,
}: PostReceiptDialogProps) {
  const { t } = useTranslation('purchasing-docs')
  const locale = useIntlLocale()
  const queryClient = useQueryClient()
  const payload = { id: receipt.id, action: 'post', version: receipt.version }
  const mutation = useMutation({
    mutationFn: ({ version }: { version: number; company: string }) =>
      receiptsApi.post(receipt.id, version, postKeys.keyFor(payload)),
    onSuccess: (posted, { company }) => {
      postKeys.release(payload)
      queryClient.setQueryData(purchKeys.detail('receipts', posted.id, company), posted)
      invalidatePurchEffects(queryClient, company)
      if (activeCompany() !== company) return
      onOpenChange(false)
      onPosted(posted)
    },
  })
  const conflict = isVersionConflict(mutation.error)
  const tracked = receipt.lines.filter(
    (l) => (l.lot_no ?? '') !== '' || l.serial_numbers.length > 0,
  ).length

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogContent closeLabel={t('actions.close')} aria-busy={mutation.isPending}>
        <DialogHeader>
          <DialogTitle>{t('receipt.postTitle')}</DialogTitle>
          <DialogDescription>{t('receipt.postBody')}</DialogDescription>
        </DialogHeader>
        <ul className="max-h-60 space-y-1 overflow-y-auto text-sm">
          {receipt.lines.map((l) => (
            <li key={l.id} className="flex justify-between gap-3">
              <span className="truncate">
                {l.item_code && <span className="font-code">{l.item_code} </span>}
                {l.description ?? l.item_name}
                {l.lot_no && <span className="text-muted-foreground"> · {l.lot_no}</span>}
              </span>
              <span className="tabular-nums">
                {qty(l.quantity, locale)} {l.unit_code ?? ''}
              </span>
            </li>
          ))}
        </ul>
        {tracked > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('receipt.postTracked', { count: tracked })}
          </p>
        )}
        {conflict ? (
          <VersionConflictAlert
            onReload={() => {
              mutation.reset()
              onOpenChange(false)
              onReload()
            }}
          />
        ) : (
          <ActionError error={mutation.error} />
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            disabled={mutation.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t('actions.cancel')}
          </Button>
          <Button
            type="button"
            disabled={mutation.isPending || conflict}
            onClick={() => mutation.mutate({ version: receipt.version, company: activeCompany() })}
          >
            {mutation.isPending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <PackageCheck aria-hidden="true" />
            )}
            {t('receipt.postConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
