// Do not edit: written by scripts/gen-wire-ts.mjs from contracts/.
// After a contract change run `npm run -w desktop wire:gen` and commit.

/**
 * Hata kodları. errors.code alanının alabileceği değerler. İlk grup backend/app/Core/Http/ErrorCode.php ile birebir aynıdır; 'Önerilen' diye işaretlenenler senkron için eklenecek yeni ErrorCode durumlarıdır (docs/SYNC-PROTOCOL.md, Açık konular). Açıklamadaki HTTP durumu, kod istek düzeyinde döndüğünde kullanılan durumdur; push sonucu içinde yanıt her zaman 200'dür.
 */
export type ErrorCode = (
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'TOO_MANY_ATTEMPTS'
  | 'HTTP_ERROR'
  | 'SERVER_ERROR'
  | 'VERSION_CONFLICT'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'IDEMPOTENCY_IN_PROGRESS'
  | 'COMPANY_REQUIRED'
  | 'COMPANY_FORBIDDEN'
  | 'TWO_FACTOR_REQUIRED'
  | 'INVALID_TWO_FACTOR_CODE'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'USER_DEACTIVATED'
  | 'INVALID_STATE_TRANSITION'
  | 'APPROVAL_REQUIRED'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'DOCUMENT_LOCKED'
  | 'DUPLICATE_RECORD'
  | 'SYNC_SCHEMA_MISMATCH'
  | 'SYNC_CURSOR_INVALID'
  | 'SYNC_RESOURCE_UNSUPPORTED'
  | 'SYNC_OFFLINE_WRITE_NOT_ALLOWED'
  | 'SYNC_BATCH_TOO_LARGE'
  | 'SYNC_DEPENDENCY_FAILED'
  | 'SYNC_BASE_VERSION_AHEAD'
  | 'SYNC_CHANGED_FIELDS_MISMATCH'
  | 'SYNC_RESOLUTION_INVALID'
)
