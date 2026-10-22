import { X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { SupplierPicker } from './SupplierPicker'

export interface SupplierRef {
  id: string
  name: string
}

interface SupplierListProps {
  id?: string
  value: SupplierRef[]
  onChange: (next: SupplierRef[]) => void
  disabled?: boolean
  max?: number
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

/** Invited suppliers of an RFQ: pick to add, remove per chip; duplicates are ignored. */
export function SupplierList({
  value,
  onChange,
  disabled = false,
  max = 100,
  ...control
}: SupplierListProps) {
  const { t } = useTranslation('purchasing-orders')
  // The picker resets after each pick.
  const [round, setRound] = useState(0)
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul aria-label={t('rfqs.suppliers')} className="flex flex-wrap gap-1.5">
          {value.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-1 rounded-md border border-border bg-surface-sunken py-0.5 pr-0.5 pl-2 text-sm"
            >
              {s.name}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={disabled}
                aria-label={t('rfqs.removeSupplier', { name: s.name })}
                onClick={() => onChange(value.filter((x) => x.id !== s.id))}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!disabled && value.length < max && (
        <SupplierPicker
          key={round}
          {...control}
          value=""
          placeholder={t('rfqs.addSupplier')}
          onChange={(id, party) => {
            if (!id || value.some((s) => s.id === id)) return
            onChange([...value, { id, name: party?.name ?? id }])
            setRound((r) => r + 1)
          }}
        />
      )}
    </div>
  )
}
