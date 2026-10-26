import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
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
import { platform } from '@/platform'
import { reservationsApi } from '../../documents/api/client'
import { activeCompany, invalidateStockEffects, invDocsKeys } from '../../documents/api/keys'
import { ActionError } from '../../documents/components/ActionError'
import { VersionConflictAlert } from '../../documents/components/VersionConflictAlert'
import { isVersionConflict } from '../../documents/lib/errors'
import { usePayloadKeys } from '../../documents/lib/idempotency'
import type { StockReservation } from '../../documents/types'

interface ReleaseDialogProps {
  reservation: StockReservation | null
  /** "STK-001 · Bolt" and "12 ADET" as the list shows them. */
  itemLabel: string
  quantityLabel: string
  onClose: () => void
}

/** POST /stock-reservations/{id}/release {version}: the quantity becomes available again. */
export function ReleaseDialog({
  reservation,
  itemLabel,
  quantityLabel,
  onClose,
}: ReleaseDialogProps) {
  const { t } = useTranslation('inventoryDocs')
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const release = useMutation({
    mutationFn: ({ target }: { target: StockReservation; company: string }) =>
      reservationsApi.release(
        target.id,
        target.version,
        keyFor({ release: target.id, version: target.version }),
      ),
    onSuccess: (_, { company }) => {
      // Available stock changes with the reservation.
      invalidateStockEffects(queryClient, company)
      if (activeCompany() !== company) return
      platform.notify.success(t('reservation.released'))
      close()
    },
  })
  const close = () => {
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
              t('reservation.releaseBody', { item: itemLabel, quantity: quantityLabel })}
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
