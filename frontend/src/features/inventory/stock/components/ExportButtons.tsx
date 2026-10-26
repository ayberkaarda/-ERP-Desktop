import { Download, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { toIsoDate } from '@/lib/datetime'
import { platform } from '@/platform'
import { downloadExport, exportFilename, type ExportFormat } from '../lib/download'
import { errorMessage } from '../lib/errors'
import { useInvT } from '../lib/i18n'

interface ExportButtonsProps {
  /** List path, e.g. "/stock-balances"; the export lives at `<path>/export`. */
  path: string
  params: Record<string, string | number>
  filename: string
  disabled?: boolean
}

/** CSV/XLSX export through the server exporter (row cap and formula guard live there). */
export function ExportButtons({ path, params, filename, disabled = false }: ExportButtonsProps) {
  const t = useInvT()
  const [busy, setBusy] = useState<ExportFormat | null>(null)

  const run = async (format: ExportFormat) => {
    setBusy(format)
    try {
      await downloadExport(
        path,
        format,
        params,
        exportFilename(filename, format, toIsoDate(new Date())),
      )
    } catch (error) {
      platform.notify.error(errorMessage(error, t('common.export.failed')))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div role="group" aria-label={t('common.export.label')} className="flex items-center gap-1">
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
          {t(`common.export.${format}`)}
        </Button>
      ))}
    </div>
  )
}
