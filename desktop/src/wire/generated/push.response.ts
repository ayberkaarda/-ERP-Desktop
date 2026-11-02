// Do not edit: written by scripts/gen-wire-ts.mjs from contracts/.
// After a contract change run `npm run -w desktop wire:gen` and commit.

export type Result = {
  /**
   * İstemcinin ürettiği UUIDv7. Sunucuda doğrudan birincil anahtar olur (ADR 0002).
   */
  idempotency_key: string
  /**
   * Senkron kaynak adı. /api/v1 sonrasındaki yolun parametresiz bölümlerinin '.' ile birleşimidir: 'parties', 'items.variants', 'treasury-reports.receivables-ageing'.
   */
  resource: string
  /**
   * İstemcinin ürettiği UUIDv7. Sunucuda doğrudan birincil anahtar olur (ADR 0002).
   */
  id: string
  /**
   * applied: uygulandı. duplicate: aynı idempotency_key ile daha önce applied olmuş bir mutasyonun tekrarı; ilk sonucun version/data'sı aynen döner. conflict: kullanıcı kararı gerekir (Conflict Inbox). rejected: kalıcı hata. Daha önce conflict veya rejected olmuş bir anahtar tekrar gelirse saklanan sonuç aynı statüyle ve replayed=true ile döner; duplicate yalnızca başarılı tekrarlar içindir.
   */
  status: 'applied' | 'duplicate' | 'conflict' | 'rejected'
  /**
   * Sonuç bu istekte üretilmedi, saklanan sonuçtan döndü. duplicate için her zaman true, applied için her zaman false.
   */
  replayed: boolean
  /**
   * Yazma sonrası sürüm. delete dışında applied/duplicate için zorunlu.
   */
  version?: number
  /**
   * Yazma sonrası REST API Resource JSON'u, manifestteki embeds yüklenmiş olarak (ör. lines). İstemci yerel satırı bununla tümüyle değiştirir. delete için null.
   */
  data?: ResourceRow | null
  /**
   * base_version eskiydi ama kesişim yoktu; sunucunun aradaki değişiklikleri korunarak uygulanan alanlar.
   */
  merged_fields?: string[]
  conflict?: Conflict
  error?: ApiError
}
export type Conflict = {
  code: 'VERSION_CONFLICT' | 'DOCUMENT_LOCKED' | 'DUPLICATE_RECORD'
  message?: string
  base_version: number | null
  server_version: number | null
  /**
   * VERSION_CONFLICT: changed_fields ile base_version'dan beri sunucuda değişen alanların kesişimi; delete ve action için sürüm farkı yeterlidir ve liste boş olabilir.
   */
  conflicting_fields: string[]
  /**
   * Kaydın sunucudaki güncel REST Resource JSON'u (DUPLICATE_RECORD için null).
   */
  server_data: ResourceRow | null
  /**
   * DUPLICATE_RECORD: mükerrer aday kayıtların kimlikleri (GET /parties/duplicates sonucu).
   *
   * @minItems 1
   *
   * Items: Küçük harfli kanonik UUID (herhangi bir sürüm). Sunucunun ürettiği satır kimlikleri için.
   */
  candidates?: [string, ...string[]]
  /**
   * İstemcinin sunacağı çözüm seçenekleri; çakışma türüne göre sınırlıdır.
   *
   * @minItems 1
   */
  choices: [
    'keep_mine' | 'take_server' | 'merge' | 'save_as_new_draft' | 'discard' | 'use_existing',
    ...('keep_mine' | 'take_server' | 'merge' | 'save_as_new_draft' | 'discard' | 'use_existing')[]
  ]
}
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

/**
 * POST /api/v1/sync/push yanıtı. Parti işlendiyse HTTP 200 ve isteğe göre aynı sırada, mutasyon başına bir sonuç. İstek düzeyindeki hatalar (kimlik, şirket, şema, parti boyutu) error.response.schema.json biçiminde döner.
 */
export interface PushResponse {
  data: {
    results: Result[]
  }
  meta: Meta
}
/**
 * Kaynağın REST API Resource'u ile birebir aynı JSON. Sözleşme yalnızca id alanını şart koşar; geri kalan şekil OpenAPI'deki ilgili Resource şemasıdır.
 */
export interface ResourceRow {
  /**
   * Küçük harfli kanonik UUID (herhangi bir sürüm). Sunucunun ürettiği satır kimlikleri için.
   */
  id: string
  version?: number
  [k: string]: unknown
}
/**
 * API hata gövdesindeki errors nesnesi: {message, code, fields?} (docs/ENGINEERING-RULES.md).
 */
export interface ApiError {
  message: string
  code: ErrorCode
  fields?: {
    [k: string]: string[]
  }
}
/**
 * Başarılı yanıtın meta nesnesi. Senkron uçları ek alan koymaz; ileride eklenebilir.
 */
export interface Meta {
  [k: string]: unknown
}
