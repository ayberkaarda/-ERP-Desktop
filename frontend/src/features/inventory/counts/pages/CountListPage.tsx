import { StockDocumentListPage } from '../../documents/pages/StockDocumentListPage'

/** Counts are stock documents of type count, listed on their own page. */
export function CountListPage() {
  return <StockDocumentListPage mode="counts" />
}
