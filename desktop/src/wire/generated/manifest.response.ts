// Do not edit: written by scripts/gen-wire-ts.mjs from contracts/.
// After a contract change run `npm run -w desktop wire:gen` and commit.

/**
 * GET /api/v1/sync/manifest yanıtı. Etkin şirket (X-Company-Id) ve kullanıcı için senkron kapsamı. resources, contracts/offline-manifest.json içeriğinin kullanıcının izinleriyle süzülmüş hâlidir; listede olmayan kaynak istemcide tutulmaz.
 */
export interface ManifestResponse {
  data: {
    /**
     * Senkron tel biçiminin sürümü. Uyumsuz değişiklikte artar.
     */
    schema_version: number
    /**
     * Senkron tel biçiminin sürümü. Uyumsuz değişiklikte artar.
     */
    min_schema_version: number
    /**
     * contracts/offline-manifest.json içindeki manifest_version.
     */
    offline_manifest_version: number
    /**
     * ISO 8601 zaman damgası, saat dilimi ofsetiyle (API Resource'ların toIso8601String çıktısı).
     */
    server_time: string
    /**
     * Küçük harfli kanonik UUID (herhangi bir sürüm). Sunucunun ürettiği satır kimlikleri için.
     */
    company_id: string
    /**
     * Küçük harfli kanonik UUID (herhangi bir sürüm). Sunucunun ürettiği satır kimlikleri için.
     */
    user_id: string
    /**
     * Token bir cihaz token'ı ise user_devices kimliği; tarayıcı oturumunda null.
     */
    device_id: string | null
    /**
     * Etkin şirketteki etkin izinler, alfabetik.
     *
     * Items: Modüllerin permissions.php dosyalarındaki izin adı (ör. 'parties.view', 'sales.quotes.create').
     */
    permissions: string[]
    resources: Resource[]
    /**
     * Kullanıcının yetkili olduğu ama çevrimdışıyken devre dışı kalacak işlemlerin anahtarları (offline-manifest online_only[].action).
     */
    online_only: string[]
    limits: Limits
  }
  meta: Meta
}
export interface Resource {
  /**
   * Senkron kaynak adı. /api/v1 sonrasındaki yolun parametresiz bölümlerinin '.' ile birleşimidir: 'parties', 'items.variants', 'treasury-reports.receivables-ageing'.
   */
  resource: string
  /**
   * Kaynağın şirket kapsamı. company: company_id = etkin şirket. company_or_global: company_id IS NULL (sistem satırı, ör. TCMB kuru, resmî vergi kodu) veya etkin şirket. global_with_company_activation: satırlar globaldir (company_id yok); şirkete özel durum ayrı aktivasyon tablosundadır ve satırın etkin değişiklik konumu ikisinin büyüğüdür (currencies + company_currencies).
   */
  scope: 'company' | 'company_or_global' | 'global_with_company_activation'
  /**
   * Kaynağın bu kullanıcı-şirket için güncel görünürlük nesli. İstemcinin cursor.gen değeri farklıysa bir sonraki pull bu kaynak için reset döner.
   */
  visibility_generation: number
  read: 'local-first' | 'online-first' | 'offline-fallback'
  /**
   * pull: /sync/pull ile artımlı. snapshot: REST ucundan tümüyle alınan, 'şu tarih itibarıyla' etiketli anlık görüntü.
   */
  source: 'pull' | 'snapshot'
  window_days: number | null
  /**
   * Kullanıcının bu kaynakta draft-outbox ile yapabileceği işlemler (izin süzgecinden sonra). Boşsa salt okunur.
   */
  writable: string[]
}
export interface Limits {
  pull_resources_max: number
  pull_page_default: number
  pull_page_max: number
  push_batch_max: number
  tombstone_retention_days: number
  idempotency_retention_days: number
}
/**
 * Başarılı yanıtın meta nesnesi. Senkron uçları ek alan koymaz; ileride eklenebilir.
 */
export interface Meta {
  [k: string]: unknown
}
