import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FieldShell } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'
import { platform } from '@/platform'
import { reservationsApi } from '../../documents/api/client'
import { activeCompany, invDocsKeys } from '../../documents/api/keys'
import { VersionConflictAlert } from '../../documents/components/VersionConflictAlert'
import { isVersionConflict } from '../../documents/lib/errors'
import { trimDecimal } from '../../documents/lib/quantity'
import { ActionError } from '../../documents/components/ActionError'
import type { StockReservation } from '../../documents/types'

interface ReleaseDialogProps {
  reservation: StockReservation | null
  onClose: () => void
}

/** POST /stock-reservations/{id}/release {version, reason}: the quantity becomes available. */
export function ReleaseDialog({ reservation, onClose }: ReleaseDialogProps) {
  const { t } = useTranslation('inventoryDocs')
  const locale = useIntlLocale()
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const release = useMutation({
    mutationFn: ({ target }: { target: StockReservation; company: string }) =>
      reservationsApi.release(target.id, {
        version: target.version,
        reason: reason.trim() || null,
      }),
    onSuccess: (_, { company }) => {
      void queryClient.invalidateQueries({ queryKey: invDocsKeys.reservations(company) })
      if (activeCompany() !== company) return
      platform.notify.success(t('reservation.released'))
      close()
    },
  })
  const close = () => {
    setReason('')
    release.reset()
    onClose()
  }
  const conflict = isVersionConflict(release.error)

  return (
    <Dialog
      open={reservation !== null}
      onOpenChange={(open) => !open && !release.isPending && close()}
    >
      <DialogContent closeLabel={t('actions.close')}>
        <DialogHeader>
          <DialogTitle>{t('reservation.releaseTitle')}</DialogTitle>
          <DialogDescription>
            {reservation &&
              t('reservation.releaseBody', {
                item: [reservation.item_code, reservation.item_name].filter(Boolean).join(' · '),
                quantity: `${formatDecimalDisplay(trimDecimal(reservation.quantity), {
                  locale,
                  minFraction: 0,
                  maxFraction: 6,
                })} ${reservation.unit_code ?? ''}`.trim(),
              })}
          </DialogDescription>
        </DialogHeader>
        {conflict ? (
          <VersionConflictAlert
            onReload={() => {
              void queryClient.invalidateQueries({ queryKey: invDocsKeys.reservations() })
              close()
            }}
          />
        ) : (
          <ActionError error={release.error} />
        )}
        <FieldShell label={t('reservation.releaseReason')}>
          {(control) => (
            <Textarea
              {...control}
              value={reason}
              rows={2}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </FieldShell>
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={release.isPending} onClick={close}>
            {t('actions.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={release.isPending || conflict}
            onClick={() =>
              reservation && release.mutate({ target: reservation, company: activeCompany() })
            }
          >
            {release.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
            {t('reservation.release')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
