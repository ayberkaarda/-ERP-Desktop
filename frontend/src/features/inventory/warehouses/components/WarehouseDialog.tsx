import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { Form, FormErrorSummary } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MSG } from '@/lib/forms'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { VersionConflictAlert } from '../../stock/components/common'
import { CheckboxField, SelectField, TextAreaField, TextField } from '../../stock/components/form'
import { warehousesApi } from '../../stock/lib/api'
import { isUncertain, isVersionConflict } from '../../stock/lib/errors'
import { useInvT } from '../../stock/lib/i18n'
import { usePayloadKeys } from '../../stock/lib/idempotency'
import { useInvKeys } from '../../stock/lib/keys'
import { INV_PERMISSIONS } from '../../stock/lib/permissions'
import { useSaveWarehouse } from '../../stock/lib/queries'
import { RESERVATION_POLICIES, type Warehouse, type WarehouseInput } from '../../stock/lib/types'
import { LocationsPanel } from './LocationsPanel'

const schema = z.object({
  code: z.string().trim().min(1, MSG.required).max(20, MSG.max),
  name: z.string().trim().min(1, MSG.required).max(120, MSG.max),
  address: z.string().max(500, MSG.max),
  is_active: z.boolean(),
  is_default: z.boolean(),
  allow_negative_stock: z.boolean(),
  reservation_policy: z.enum(['none', 'soft', 'hard']),
})

type Values = z.infer<typeof schema>

function toValues(w: Warehouse | null): Values {
  return {
    code: w?.code ?? '',
    name: w?.name ?? '',
    address: w?.address ?? '',
    is_active: w?.is_active ?? true,
    is_default: w?.is_default ?? false,
    allow_negative_stock: w?.allow_negative_stock ?? false,
    reservation_policy: w?.reservation_policy ?? 'soft',
  }
}

function toInput(v: Values): WarehouseInput {
  return {
    code: v.code.trim(),
    name: v.name.trim(),
    address: v.address.trim() === '' ? null : v.address.trim(),
    is_active: v.is_active,
    is_default: v.is_default,
    allow_negative_stock: v.allow_negative_stock,
    reservation_policy: v.reservation_policy,
  }
}

interface WarehouseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null creates a new warehouse. */
  warehouse: Warehouse | null
  /** The company's current default, to explain what changing it does. */
  currentDefault?: Warehouse | null
  initialTab?: 'general' | 'locations'
  onSaved?: (warehouse: Warehouse) => void
}

/**
 * Create or edit a warehouse; existing warehouses also show their locations tree. Mount it per
 * opening (keyed by the record) so every opening starts from a fresh form.
 */
export function WarehouseDialog({
  open,
  onOpenChange,
  warehouse: initial,
  currentDefault,
  initialTab = 'general',
  onSaved,
}: WarehouseDialogProps) {
  const t = useInvT()
  const { t: tc } = useTranslation('common')
  const canManage = usePermission(INV_PERMISSIONS.warehouses.manage)
  const keys = useInvKeys()
  const qc = useQueryClient()
  const save = useSaveWarehouse()
  const keyFor = usePayloadKeys()
  const [warehouse, setWarehouse] = useState<Warehouse | null>(initial)
  const [tab, setTab] = useState(initialTab)
  const [reloading, setReloading] = useState(false)
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(initial) })
  const { reset } = form

  const editing = warehouse !== null
  const readOnly = !canManage
  const busy = save.isPending
  const conflict = isVersionConflict(save.error)
  const policy = useWatch({ control: form.control, name: 'reservation_policy' })
  const isDefault = useWatch({ control: form.control, name: 'is_default' })
  const wasDefault = warehouse?.is_default ?? false

  const reload = async () => {
    if (!warehouse) return
    setReloading(true)
    try {
      const fresh = await warehousesApi.get(warehouse.id)
      setWarehouse(fresh)
      reset(toValues(fresh))
      save.reset()
      void qc.invalidateQueries({ queryKey: keys.warehouses() })
    } catch {
      platform.notify.error(t('common.loadFailed'))
    } finally {
      setReloading(false)
    }
  }

  const submit = async (values: Values) => {
    const input = toInput(values)
    try {
      const saved = warehouse
        ? await save.mutateAsync({
            mode: 'update',
            id: warehouse.id,
            version: warehouse.version,
            patch: input,
          })
        : await save.mutateAsync({ mode: 'create', input, key: keyFor(input) })
      platform.notify.success(
        t(warehouse ? 'warehouses.updated' : 'warehouses.created', { code: saved.code }),
      )
      onSaved?.(saved)
      if (warehouse) {
        onOpenChange(false)
      } else {
        // A new warehouse stays open on its locations so bins can be added right away.
        setWarehouse(saved)
        reset(toValues(saved))
        setTab('locations')
      }
    } catch {
      // Shown by the error summary / conflict alert.
    }
  }

  const title = editing
    ? readOnly
      ? t('warehouses.viewTitle', { code: warehouse.code })
      : t('warehouses.editTitle', { code: warehouse.code })
    : t('warehouses.newTitle')

  const fieldLabels = {
    code: t('warehouses.fields.code'),
    name: t('warehouses.fields.name'),
    address: t('warehouses.fields.address'),
    is_default: t('warehouses.fields.isDefault'),
    allow_negative_stock: t('warehouses.fields.allowNegative'),
    reservation_policy: t('warehouses.fields.reservationPolicy'),
  }

  let defaultHelp: string | undefined
  if (wasDefault) defaultHelp = t('warehouses.defaultLocked')
  else if (isDefault && currentDefault && currentDefault.id !== warehouse?.id)
    defaultHelp = t('warehouses.defaultMoves', { code: currentDefault.code })
  else defaultHelp = t('warehouses.defaultHelp')

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent
        closeLabel={tc('actions.close')}
        className="max-h-[90dvh] max-w-2xl overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {editing ? `${warehouse.code} · ${warehouse.name}` : t('warehouses.newBody')}
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'general' | 'locations')}>
          <TabsList aria-label={title}>
            <TabsTrigger value="general">{t('warehouses.tabs.general')}</TabsTrigger>
            <TabsTrigger value="locations" disabled={!editing}>
              {t('warehouses.tabs.locations')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="general" className="pt-4">
            <Form form={form} onSubmit={submit} className="grid gap-4" aria-label={title}>
              {conflict ? (
                <VersionConflictAlert onReload={() => void reload()} busy={reloading} />
              ) : save.error && isUncertain(save.error) ? (
                <p role="alert" className="text-sm text-warning-soft-foreground">
                  {t('common.uncertain')}
                </p>
              ) : (
                <FormErrorSummary error={save.error} fieldLabels={fieldLabels} />
              )}
              <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-[10rem_1fr]">
                <TextField<Values, 'code'>
                  name="code"
                  label={fieldLabels.code}
                  required
                  input={{ maxLength: 20, autoComplete: 'off', className: 'font-code' }}
                />
                <TextField<Values, 'name'>
                  name="name"
                  label={fieldLabels.name}
                  required
                  input={{ maxLength: 120 }}
                />
                <TextAreaField<Values, 'address'>
                  name="address"
                  label={fieldLabels.address}
                  maxLength={500}
                  className="sm:col-span-2"
                />
              </fieldset>
              <fieldset
                disabled={readOnly}
                className="grid gap-3 rounded-md border border-border p-3"
              >
                <legend className="px-1 text-xs font-medium text-muted-foreground">
                  {t('warehouses.settings')}
                </legend>
                <CheckboxField<Values>
                  name="is_default"
                  label={fieldLabels.is_default}
                  description={defaultHelp}
                  disabled={readOnly || wasDefault}
                />
                <CheckboxField<Values>
                  name="allow_negative_stock"
                  label={fieldLabels.allow_negative_stock}
                  description={t('warehouses.allowNegativeHelp')}
                />
                <CheckboxField<Values>
                  name="is_active"
                  label={t('warehouses.fields.isActive')}
                  description={t('warehouses.activeHelp')}
                  disabled={readOnly || wasDefault}
                />
                <SelectField<Values, 'reservation_policy'>
                  name="reservation_policy"
                  label={fieldLabels.reservation_policy}
                  disabled={readOnly}
                  description={t(`warehouses.policyHelp.${policy}`)}
                  options={RESERVATION_POLICIES.map((p) => ({
                    value: p,
                    label: t(`warehouses.policy.${p}`),
                  }))}
                />
              </fieldset>
              <DialogFooter>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onOpenChange(false)}
                >
                  {readOnly ? tc('actions.close') : tc('actions.cancel')}
                </Button>
                {!readOnly && (
                  <Button type="submit" disabled={busy || conflict}>
                    {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
                    {tc('actions.save')}
                  </Button>
                )}
              </DialogFooter>
            </Form>
          </TabsContent>
          <TabsContent value="locations" className="pt-4">
            {warehouse && <LocationsPanel warehouse={warehouse} canManage={canManage} />}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
