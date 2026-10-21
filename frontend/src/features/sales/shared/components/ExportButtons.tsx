import { Download, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { toIsoDate } from '@/lib/datetime'
import { platform } from '@/platform'
import { downloadExport, type ExportFormat } from '../lib/download'
import { errorMessage } from '../lib/errors'

interface ExportButtonsProps {
  /** List path; the export lives at `<path>/export`. */
  path: string
  params: Record<string, string>
  filename: string
}

/** CSV/XLSX export of the filtered list (the server caps rows and guards formulas). */
export function ExportButtons({ path, params, filename }: ExportButtonsProps) {
  const { t } = useTranslation('sales-shared')
  const [busy, setBusy] = useState<ExportFormat | null>(null)

  const run = async (format: ExportFormat) => {
    setBusy(format)
    try {
      await downloadExport(path, format, params, `${filename}-${toIsoDate(new Date())}`)
    } catch (error) {
      platform.notify.error(errorMessage(error, t('export.failed')))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div role="group" aria-label={t('export.label')} className="flex items-center gap-1">
      {(['csv', 'xlsx'] as const).map((format) => (
        <Button
          key={format}
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy !== null}
          onClick={() => void run(format)}
        >
          {busy === format ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Download aria-hidden="true" />
          )}
          {t(`export.${format}`)}
        </Button>
      ))}
    </div>
  )
}
