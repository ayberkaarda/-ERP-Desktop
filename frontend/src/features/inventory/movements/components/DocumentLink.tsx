import { BookOpenText, FileText } from 'lucide-react'
import { Link } from 'react-router'
import { usePermission } from '@/lib/permissions'
import { useInvT } from '../../stock/lib/i18n'
import { documentPath, journalEntryPath } from '../../stock/lib/navigation'
import { INV_PERMISSIONS } from '../../stock/lib/permissions'
import type { StockMovement } from '../../stock/lib/types'

const STOCK_DOCUMENT = 'stock_document'

/** Source document of a movement; stock documents and journal entries link to their screens. */
export function DocumentLink({ movement }: { movement: StockMovement }) {
  const t = useInvT()
  const canDocs = usePermission(INV_PERMISSIONS.documents.view)
  const canJournal = usePermission(INV_PERMISSIONS.entries.view)
  const { document_type: type, document_id: id } = movement
  const label = movement.document_number ?? t('movements.unnumbered')
  const typeLabel = type ? t(`documentTypes.${type}`, { defaultValue: type }) : null
  return (
    <span className="inline-flex items-center gap-2">
      {type && id ? (
        type === STOCK_DOCUMENT && canDocs ? (
          <Link
            to={documentPath(id)}
            className="inline-flex items-center gap-1 font-code hover:underline"
            aria-label={t('movements.openDocument', { number: label })}
          >
            <FileText className="size-3.5" aria-hidden="true" />
            {label}
          </Link>
        ) : (
          <span className="font-code" title={typeLabel ?? undefined}>
            {label}
          </span>
        )
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
      {movement.journal_entry_id && canJournal && (
        <Link
          to={journalEntryPath(movement.journal_entry_id)}
          className="text-muted-foreground hover:text-foreground"
          aria-label={t('movements.openJournal', { number: label })}
          title={t('movements.journal')}
        >
          <BookOpenText className="size-3.5" aria-hidden="true" />
        </Link>
      )}
    </span>
  )
}
