import { Download, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { toIsoDate } from '@/lib/datetime'
import { platform } from '@/platform'
import {
  downloadFile,
  EXPORT_MIME,
  exportFilename,
  exportPath,
  type ExportFormat,
} from '../lib/download'
import { errorMessage } from '../lib/errors'

interface ExportButtonsProps {
  /** Resource path, e.g. "/reports/trial-balance"; the export lives at `<path>/export`. */
  path: string
  params: Record<string, string | number>
  filename: string
  disabled?: boolean
}

/** CSV/XLSX export through the server exporter (50k row cap and formula guard live there). */
export function ExportButtons({ path, params, filename, disabled = false }: ExportButtonsProps) {
  const { t } = useTranslation('inventoryDocs')
  const [busy, setBusy] = useState<ExportFormat | null>(null)

  const run = async (format: ExportFormat) => {
    setBusy(format)
    try {
      await downloadFile(exportPath(path), {
        params: { ...params, format },
        mime: EXPORT_MIME[format],
        filename: exportFilename(filename, format, toIsoDate(new Date())),
      })
    } catch (error) {
      platform.notify.error(errorMessage(error, t('export.failed')))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      role="group"
      aria-label={t('export.label')}
      className="flex items-center gap-1 print:hidden"
    >
      {(['csv', 'xlsx'] as const).map((format) => (
        <Button
          key={format}
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || busy !== null}
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
