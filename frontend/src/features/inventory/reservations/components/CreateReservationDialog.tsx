import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import {
  DateInput,
  DecimalInput,
  Form,
  FormErrorSummary,
  FormField,
} from '@/components/shared/form'
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
import { formatDecimalDisplay } from '@/lib/money'
import { useIntlLocale } from '@/lib/datetime'
import { snakeToCamelPath } from '@/lib/forms'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { ItemCombobox, type Item } from '@/features/catalog'
import { lookupsApi, reservationsApi } from '../../documents/api/client'
import { activeCompany, invalidateStockEffects, invDocsKeys } from '../../documents/api/keys'
import { WarehouseSelect } from '../../documents/components/pickers'
import { usePayloadKeys } from '../../documents/lib/idempotency'
import { toItemRef, usesLot } from '../../documents/lib/lines'
import { dec, isDecimal, trimDecimal } from '../../documents/lib/quantity'
import { selectClass } from '../../documents/lib/ui'
import { INV_PERMS } from '../../documents/permissions'
import type { ItemRef, ReservationInput } from '../../documents/types'

interface Values {
  itemId: string
  warehouseId: string
  lotId: string
  quantity: string
  expiresAt: string
  notes: string
}

const EMPTY: Values = {
  itemId: '',
  warehouseId: '',
  lotId: '',
  quantity: '',
  expiresAt: '',
  notes: '',
}

/**
 * POST /stock-reservations (inventory.reservations.manage): a manual reservation of an item in a
 * warehouse, optionally of one lot, until an optional date. Under a soft warehouse policy the
 * server accepts more than is available and reports the shortage.
 */
export function CreateReservationDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('inventoryDocs')
  const locale = useIntlLocale()
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const canReadLots = usePermission(INV_PERMS.stockView)
  const [item, setItem] = useState<ItemRef | null>(null)
  const schema = z.object({
    itemId: z.string().min(1, t('validation.item')),
    warehouseId: z.string().min(1, t('validation.warehouse')),
    lotId: z.string(),
    quantity: z
      .string()
      .refine((v) => isDecimal(v) && dec(v).gt(0), t('validation.quantityPositive')),
    expiresAt: z.string(),
    notes: z.string().max(500, t('validation.tooLong')),
  })
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: EMPTY })
  const itemId = useWatch({ control: form.control, name: 'itemId' })
  const lots = useQuery({
    queryKey: invDocsKeys.itemLots(itemId),
    queryFn: ({ signal }) => lookupsApi.itemLots(itemId, signal),
    enabled: open && canReadLots && itemId !== '' && usesLot(item),
    staleTime: 60_000,
  })

  const create = useMutation({
    mutationFn: ({ v }: { v: Values; company: string }) => {
      const input: ReservationInput = {
        item_id: v.itemId,
        warehouse_id: v.warehouseId,
        lot_id: v.lotId || null,
        quantity: v.quantity,
        expires_at: v.expiresAt || null,
        notes: v.notes.trim() || null,
      }
      return reservationsApi.create(input, keyFor(input))
    },
    onSuccess: (res, { company }) => {
      // The reservation exists now: an identical submit later is a new reservation, not a retry.
      keyFor.reset()
      invalidateStockEffects(queryClient, company)
      if (activeCompany() !== company) return
      const shortage = res.meta?.shortage
      if (shortage && isDecimal(shortage) && dec(shortage).gt(0)) {
        platform.notify.warning(
          t('reservation.shortage', {
            quantity: formatDecimalDisplay(trimDecimal(shortage), {
              locale,
              minFraction: 0,
              maxFraction: 6,
            }),
          }),
        )
      } else {
        platform.notify.success(t('reservation.created'))
      }
      close()
    },
  })

  const close = () => {
    form.reset(EMPTY)
    setItem(null)
    create.reset()
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : !create.isPending && close())}
    >
      <DialogContent closeLabel={t('actions.close')}>
        <Form
          form={form}
          onSubmit={(v) => create.mutate({ v, company: activeCompany() })}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>{t('reservation.createTitle')}</DialogTitle>
            <DialogDescription>{t('reservation.createBody')}</DialogDescription>
          </DialogHeader>
          <FormErrorSummary
            error={create.error}
            mapField={snakeToCamelPath}
            fieldLabels={{
              itemId: t('fields.item'),
              warehouseId: t('fields.warehouse'),
              lotId: t('reservation.lot'),
              quantity: t('reservation.quantity'),
              expiresAt: t('reservation.expiresAt'),
              notes: t('fields.notes'),
            }}
          />
          <FormField<Values, 'itemId'>
            name="itemId"
            label={t('fields.item')}
            required
            render={({ field, control }) => (
              <ItemCombobox
                {...control}
                ref={field.ref}
                value={field.value || null}
                type="stock"
                onBlur={field.onBlur}
                onChange={(id: string | null, picked: Item | null) => {
                  field.onChange(id ?? '')
                  setItem(picked ? toItemRef(picked) : null)
                  form.setValue('lotId', '')
                }}
              />
            )}
          />
          <FormField<Values, 'warehouseId'>
            name="warehouseId"
            label={t('fields.warehouse')}
            required
            render={({ field, control }) => (
              <WarehouseSelect
                {...control}
                ref={field.ref}
                value={field.value}
                onBlur={field.onBlur}
                onChange={field.onChange}
              />
            )}
          />
          {usesLot(item) && canReadLots && (
            <FormField<Values, 'lotId'>
              name="lotId"
              label={t('reservation.lot')}
              render={({ field, control }) => (
                <select
                  {...control}
                  ref={field.ref}
                  name={field.name}
                  value={field.value}
                  className={selectClass}
                  onChange={(e) => field.onChange(e.target.value)}
                  onBlur={field.onBlur}
                >
                  <option value="">{t('reservation.anyLot')}</option>
                  {(lots.data ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.expiry_date ? `${l.lot_no} (${l.expiry_date})` : l.lot_no}
                    </option>
                  ))}
                </select>
              )}
            />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField<Values, 'quantity'>
              name="quantity"
              label={t('reservation.quantity')}
              required
              render={({ field, control }) => (
                <DecimalInput
                  {...control}
                  ref={field.ref}
                  scale={6}
                  displayMinFraction={0}
                  locale={locale}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
            <FormField<Values, 'expiresAt'>
              name="expiresAt"
              label={t('reservation.expiresAt')}
              render={({ field, control }) => (
                <DateInput
                  {...control}
                  ref={field.ref}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
          </div>
          <FormField<Values, 'notes'>
            name="notes"
            label={t('fields.notes')}
            render={({ field, control }) => <Input {...control} {...field} maxLength={500} />}
          />
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={create.isPending} onClick={close}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              {t('reservation.create')}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
