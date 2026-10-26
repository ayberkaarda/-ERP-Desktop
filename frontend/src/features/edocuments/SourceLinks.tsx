import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { usePermission } from '@/lib/permissions'
import { useEdocT } from './hooks'
export function EDocumentSourceLinks({
  id,
  number,
  kind,
}: {
  id: string
  number: string | null
  kind: 'invoice' | 'delivery'
}) {
  const t = useEdocT()
  const allowed = usePermission([
    'edocuments.view',
    'edocuments.create',
    kind === 'invoice' ? 'sales.invoices.view' : 'sales.deliveries.view',
  ])
  if (!allowed) return null
  return (
    <>
      {(kind === 'invoice' ? ['e_invoice', 'e_archive'] : ['e_despatch']).map((type) => (
        <Button asChild key={type} size="sm" variant="secondary">
          <Link
            to={`/edocuments/outbox/new?${new URLSearchParams({ kind: type, source_id: id, ...(number ? { source_number: number } : {}) })}`}
          >
            {t(`prepare_${type}`)}
          </Link>
        </Button>
      ))}
    </>
  )
}
