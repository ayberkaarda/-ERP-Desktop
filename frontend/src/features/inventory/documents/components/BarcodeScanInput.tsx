import { Loader2, ScanBarcode } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FieldShell } from '@/components/shared/form'
import { Input } from '@/components/ui/input'
import { platform } from '@/platform'
import { lookupsApi, type BarcodeHit } from '../api/client'

interface BarcodeScanInputProps {
  onHit: (hit: BarcodeHit) => void
  disabled?: boolean
}

/**
 * Hand scanners type the code and press Enter: the code is resolved to an item (and the unit
 * its barcode stands for) and handed to the editor; the field clears for the next scan.
 */
export function BarcodeScanInput({ onHit, disabled = false }: BarcodeScanInputProps) {
  const { t } = useTranslation('inventoryDocs')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const resolve = async () => {
    const scanned = code.trim()
    if (!scanned || busy) return
    setBusy(true)
    try {
      const hit = await lookupsApi.resolveBarcode(scanned)
      if (hit) {
        onHit(hit)
        setCode('')
      } else {
        platform.notify.warning(t('scan.notFound', { code: scanned }))
      }
    } catch {
      platform.notify.error(t('scan.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FieldShell label={t('scan.label')} className="w-72">
      {(control) => (
        <div className="relative">
          <ScanBarcode
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            {...control}
            value={code}
            disabled={disabled}
            autoComplete="off"
            inputMode="text"
            placeholder={t('scan.placeholder')}
            className="pl-8 font-code"
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void resolve()
              }
            }}
          />
          {busy && (
            <Loader2
              className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
              aria-hidden="true"
            />
          )}
        </div>
      )}
    </FieldShell>
  )
}
