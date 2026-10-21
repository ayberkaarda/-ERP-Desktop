import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Loader2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
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
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import {
  stockWarehousesApi,
  useStockWarehouse,
  useWarehouseKeys,
  type StockWarehouse,
} from '../../shared/warehouses'
import { VersionConflictAlert } from '../../stock/components/common'
import { SelectField } from '../../stock/components/form'
import { isUncertain, isVersionConflict } from '../../stock/lib/errors'
import { useInvT } from '../../stock/lib/i18n'
import { INV_ACCESS, INV_PERMISSIONS } from '../../stock/lib/permissions'
import { RESERVATION_POLICIES, referenceWarehousePath } from '../lib/constants'
import { LocationsPanel } from './LocationsPanel'

const schema = z.object({ reservation_policy: z.enum(RESERVATION_POLICIES) })
type Values = z.infer<typeof schema>

export type WarehouseDialogTab = 'general' | 'locations'

interface WarehouseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  warehouse: StockWarehouse
  initialTab?: WarehouseDialogTab
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

/**
 * A warehouse as the stock ledger sees it: Reference master data (read-only here, edited on the
 * Reference warehouse screen), the inventory reservation policy (PATCH /stock-warehouses/{id}
 * with the settings version) and the locations tree. Mount it per opening.
 */
export function WarehouseDialog({
  open,
  onOpenChange,
  warehouse: initial,
  initialTab = 'general',
}: WarehouseDialogProps) {
  const t = useInvT()
  const { t: tc } = useTranslation('common')
  const canManage = usePermission(INV_PERMISSIONS.warehouses.manage)
  const canSeeLocations = usePermission(INV_PERMISSIONS.referenceWarehouses.view)
  const canEditMaster = usePermission(INV_ACCESS.referenceWarehousesEdit)
  const keys = useWarehouseKeys()
  const qc = useQueryClient()
  const detail = useStockWarehouse(initial.id)
  const [warehouse, setWarehouse] = useState<StockWarehouse>(initial)
  const [tab, setTab] = useState<WarehouseDialogTab>(
    initialTab === 'locations' && !canSeeLocations ? 'general' : initialTab,
  )
  const [reloading, setReloading] = useState(false)
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { reservation_policy: initial.reservation_policy },
  })
  const policy = useWatch({ control: form.control, name: 'reservation_policy' })
  const save = useMutation({
    mutationFn: (values: Values) =>
      stockWarehousesApi.updatePolicy(warehouse.id, {
        reservation_policy: values.reservation_policy,
        version: warehouse.version,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  })
  const busy = save.isPending
  const conflict = isVersionConflict(save.error)
  const readOnly = !canManage
  const hasMovements = detail.data?.has_movements

  const reload = async () => {
    setReloading(true)
    try {
      const fresh = await stockWarehousesApi.get(warehouse.id)
      setWarehouse(fresh)
      form.reset({ reservation_policy: fresh.reservation_policy })
      save.reset()
      void qc.invalidateQueries({ queryKey: keys.all })
    } catch {
      platform.notify.error(t('common.loadFailed'))
    } finally {
      setReloading(false)
    }
  }

  const submit = async (values: Values) => {
    try {
      const saved = await save.mutateAsync(values)
      platform.notify.success(t('warehouses.updated', { code: saved.code }))
      onOpenChange(false)
    } catch {
      // Shown by the error summary / conflict alert.
    }
  }

  const title = readOnly
    ? t('warehouses.viewTitle', { code: warehouse.code })
    : t('warehouses.editTitle', { code: warehouse.code })
  const policyLabel = t('warehouses.fields.reservationPolicy')

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent
        closeLabel={tc('actions.close')}
        className="max-h-[90dvh] max-w-2xl overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{`${warehouse.code} · ${warehouse.name}`}</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as WarehouseDialogTab)}>
          <TabsList aria-label={title}>
            <TabsTrigger value="general">{t('warehouses.tabs.general')}</TabsTrigger>
            {canSeeLocations && (
              <TabsTrigger value="locations">{t('warehouses.tabs.locations')}</TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="general" className="grid gap-4 pt-4">
            <section
              aria-label={t('warehouses.masterData')}
              className="grid gap-3 rounded-md border border-border p-3"
            >
              <dl className="grid gap-3 sm:grid-cols-3">
                <Fact label={t('warehouses.fields.negativeStock')}>
                  {t(`warehouses.negative.${warehouse.negative_stock_policy}`)}
                </Fact>
                <Fact label={t('warehouses.fields.isDefault')}>
                  {warehouse.is_default ? t('common.yes') : t('common.no')}
                </Fact>
                <Fact label={t('warehouses.fields.status')}>
                  {warehouse.is_active ? t('common.active') : t('common.inactive')}
                </Fact>
              </dl>
              {hasMovements !== undefined && (
                <p className="text-sm text-muted-foreground">
                  {hasMovements ? t('warehouses.hasMovements') : t('warehouses.noMovements')}
                </p>
              )}
              <p className="text-xs text-muted-foreground">{t('warehouses.masterDataHint')}</p>
              {canEditMaster && (
                <Link
                  to={referenceWarehousePath(warehouse.id)}
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="size-4" aria-hidden="true" />
                  {t('warehouses.openInReference', { code: warehouse.code })}
                </Link>
              )}
            </section>
            <Form form={form} onSubmit={submit} className="grid gap-4" aria-label={title}>
              {conflict ? (
                <VersionConflictAlert onReload={() => void reload()} busy={reloading} />
              ) : save.error && isUncertain(save.error) ? (
                <p role="alert" className="text-sm text-warning-soft-foreground">
                  {t('common.uncertain')}
                </p>
              ) : (
                <FormErrorSummary
                  error={save.error}
                  fieldLabels={{ reservation_policy: policyLabel }}
                />
              )}
              <SelectField<Values, 'reservation_policy'>
                name="reservation_policy"
                label={policyLabel}
                disabled={readOnly}
                description={t(`warehouses.policyHelp.${policy}`)}
                options={RESERVATION_POLICIES.map((p) => ({
                  value: p,
                  label: t(`warehouses.policy.${p}`),
                }))}
              />
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
          {canSeeLocations && (
            <TabsContent value="locations" className="pt-4">
              <LocationsPanel warehouse={warehouse} />
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
