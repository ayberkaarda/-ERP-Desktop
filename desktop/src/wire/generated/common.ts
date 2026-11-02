// Do not edit: written by scripts/gen-wire-ts.mjs from contracts/.
// After a contract change run `npm run -w desktop wire:gen` and commit.

/**
 * Küçük harfli kanonik UUID (herhangi bir sürüm). Sunucunun ürettiği satır kimlikleri için.
 */
export type Uuid = string
/**
 * İstemcinin ürettiği UUIDv7. Sunucuda doğrudan birincil anahtar olur (ADR 0002).
 */
export type Uuidv7 = string
/**
 * PostgreSQL xid8 değeri (pg_current_xact_id). 64 bit olduğu için ondalık string olarak taşınır; JavaScript sayısına çevrilmez.
 */
export type Xid8 = string
/**
 * Sunucuda (kullanıcı, şirket, kaynak) başına tutulan, görünürlüğü etkileyen her değişiklikte (rol, izin, şirket üyeliği, kapsam) artan sayaç. Tüketilen bir bayrak değildir; her cihaz kendi cursor'ındaki değeri bununla karşılaştırır.
 */
export type VisibilityGeneration = number
/**
 * Sunucunun ürettiği opak değer. Tam indirmenin has_more=true sayfalarında oturum kimliği, diğer tüm sunucu cursor'larında akış etiketidir (i_ öneki). İstemci yorumlamaz, karşılaştırmaz, üretmez; cursor ile aynen geri gönderir. Oturum/etiket bu kullanıcı, şirket, kaynak ve konum için geçerli değilse kaynak reset (cursor_expired) alır. Dolu cursor ile null session eski istemci sayılır ve bir kez reset alır; ilk indirme cursor: null ile başlar.
 */
export type CursorSession = string | null
/**
 * Kaynağın şirket kapsamı. company: company_id = etkin şirket. company_or_global: company_id IS NULL (sistem satırı, ör. TCMB kuru, resmî vergi kodu) veya etkin şirket. global_with_company_activation: satırlar globaldir (company_id yok); şirkete özel durum ayrı aktivasyon tablosundadır ve satırın etkin değişiklik konumu ikisinin büyüğüdür (currencies + company_currencies).
 */
export type Scope = 'company' | 'company_or_global' | 'global_with_company_activation'
/**
 * Senkron kaynak adı. /api/v1 sonrasındaki yolun parametresiz bölümlerinin '.' ile birleşimidir: 'parties', 'items.variants', 'treasury-reports.receivables-ageing'.
 */
export type ResourceName = string
/**
 * ISO 8601 zaman damgası, saat dilimi ofsetiyle (API Resource'ların toIso8601String çıktısı).
 */
export type Timestamp = string
/**
 * Senkron tel biçiminin sürümü. Uyumsuz değişiklikte artar.
 */
export type SchemaVersion = number
/**
 * Modüllerin permissions.php dosyalarındaki izin adı (ör. 'parties.view', 'sales.quotes.create').
 */
export type Permission = string
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
 * Senkron ortak tanımları. Senkron sözleşmelerinin paylaştığı tanımlar ($defs). Kök şema yalnızca bu tanımların örneklerini taşıyan bir nesneyi doğrular; fixture'lar her tanımı bu yolla sınar. Bkz. docs/SYNC-PROTOCOL.md.
 */
export interface CommonSamples {
  uuid?: Uuid
  uuidv7?: Uuidv7
  xid8?: Xid8
  cursor?: Cursor
  visibility_generation?: VisibilityGeneration
  scope?: Scope
  resource_name?: ResourceName
  timestamp?: Timestamp
  schema_version?: SchemaVersion
  permission?: Permission
  requires?: Requires
  api_error?: ApiError
  meta?: Meta
}
/**
 * Kaynak başına keyset konumu: (sync_txid, id), görünürlük nesli ve oturum ya da akış etiketi. after_id null ise sync_txid >= txid koşulu, değilse (sync_txid, id) > (txid, after_id) koşulu uygulanır. gen, sunucudaki (kullanıcı, şirket, kaynak) görünürlük neslinden farklıysa kaynak reset alır. session: bkz. cursorSession.
 */
export interface Cursor {
  txid: Xid8
  after_id: Uuid | null
  gen: VisibilityGeneration
  session: CursorSession
}
/**
 * Gerekli izinler. any_of: listeden biri yeterli (Catalog policy'lerindeki viewPermissions gibi). all_of: hepsi gerekli. İkisi birlikte verilirse ikisi de sağlanmalıdır.
 */
export interface Requires {
  /**
   * @minItems 1
   */
  any_of?: [Permission, ...Permission[]]
  /**
   * @minItems 1
   */
  all_of?: [Permission, ...Permission[]]
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
