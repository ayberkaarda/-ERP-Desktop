import { Loader2, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DateInput, DecimalInput, FieldShell } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useIntlLocale } from '@/lib/datetime'
import { ItemCombobox } from '@/features/catalog'
import { ActionError } from '../../documents/components/ActionError'
import { LocationSelect } from '../../documents/components/pickers'
import { toItemRef, usesLot } from '../../documents/lib/lines'
import { isDecimal } from '../../documents/lib/quantity'
import type { CountAddInput, ItemRef } from '../../documents/types'
import { useWarehouseLocations } from '../../shared/warehouses'

interface AddCountLineDialogProps {
  open: boolean
  warehouseId: string
  pending: boolean
  error: unknown
  onOpenChange: (open: boolean) => void
  onAdd: (line: CountAddInput) => void
}

/**
 * Stock found outside the snapshot (or any line of a count started empty): item, location, lot
 * and the counted quantity. Counting a key already on the count updates that line.
 */
export function AddCountLineDialog({
  open,
  warehouseId,
  pending,
  error,
  onOpenChange,
  onAdd,
}: AddCountLineDialogProps) {
  const { t } = useTranslation('inventoryDocs')
  const locale = useIntlLocale()
  const locations = useWarehouseLocations(open ? warehouseId : '')
  const [item, setItem] = useState<ItemRef | null>(null)
  const [locationId, setLocationId] = useState('')
  const [lotNo, setLotNo] = useState('')
  const [expiry, setExpiry] = useState('')
  const [quantity, setQuantity] = useState('')
  const [tried, setTried] = useState(false)

  const lotNeeded = usesLot(item)
  const problems = {
    item: item ? null : t('validation.item'),
    lot: lotNeeded && lotNo.trim() === '' ? t('validation.lot') : null,
    quantity: isDecimal(quantity) ? null : t('validation.quantity'),
  }
  const valid = !problems.item && !problems.lot && !problems.quantity

  const reset = () => {
    setItem(null)
    setLocationId('')
    setLotNo('')
    setExpiry('')
    setQuantity('')
    setTried(false)
  }

  const submit = () => {
    setTried(true)
    if (!valid || !item) return
    onAdd({
      item_id: item.id,
      location_id: locationId || null,
      lot_no: lotNeeded ? lotNo.trim() : null,
      ...(item.has_expiry && expiry ? { expiry_date: expiry } : {}),
      counted_quantity: quantity,
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent closeLabel={t('actions.close')}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('count.addTitle')}</DialogTitle>
            <DialogDescription>{t('count.addBody')}</DialogDescription>
          </DialogHeader>
          <ActionError error={error} />
          <FieldShell
            label={t('lines.item')}
            required
            error={tried ? (problems.item ?? undefined) : undefined}
          >
            {(control) => (
              <ItemCombobox
                {...control}
                value={item?.id ?? null}
                type="stock"
                onChange={(_, picked) => {
                  setItem(picked ? toItemRef(picked) : null)
                  setLotNo('')
                  setExpiry('')
                }}
              />
            )}
          </FieldShell>
          {(locations.data?.length ?? 0) > 0 && (
            <FieldShell label={t('lines.location')}>
              {(control) => (
                <LocationSelect
                  {...control}
                  warehouseId={warehouseId}
                  value={locationId}
                  onChange={setLocationId}
                />
              )}
            </FieldShell>
          )}
          {lotNeeded && (
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldShell
                label={t('lines.lot')}
                required
                error={tried ? (problems.lot ?? undefined) : undefined}
              >
                {(control) => (
                  <Input
                    {...control}
                    value={lotNo}
                    maxLength={64}
                    className="font-code"
                    onChange={(e) => setLotNo(e.target.value)}
                  />
                )}
              </FieldShell>
              {item?.has_expiry && (
                <FieldShell label={t('lines.expiry')}>
                  {(control) => <DateInput {...control} value={expiry} onChange={setExpiry} />}
                </FieldShell>
              )}
            </div>
          )}
          <FieldShell
            label={t('count.counted')}
            required
            error={tried ? (problems.quantity ?? undefined) : undefined}
          >
            {(control) => (
              <DecimalInput
                {...control}
                scale={6}
                displayMinFraction={0}
                locale={locale}
                value={quantity}
                onChange={setQuantity}
              />
            )}
          </FieldShell>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => {
                reset()
                onOpenChange(false)
              }}
            >
              {t('actions.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Plus aria-hidden="true" />
              )}
              {t('count.addLine')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
