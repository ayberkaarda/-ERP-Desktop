// Do not edit: written by scripts/gen-wire-ts.mjs from contracts/.
// After a contract change run `npm run -w desktop wire:gen` and commit.

/**
 * POST /api/v1/sync/pull yanıtı. İstekteki her kaynak için, isteğe göre aynı sırada bir sonuç. Satırlar REST API Resource JSON'udur. Bir sayfada aynı id en fazla bir kez (rows veya tombstones içinde) geçer.
 */
export interface PullResponse {
  data: {
    /**
     * pg_snapshot_xmin(pg_current_snapshot()). Bu yanıttaki tüm satırlar sync_txid < horizon koşulunu sağlar.
     */
    horizon: string
    /**
     * ISO 8601 zaman damgası, saat dilimi ofsetiyle (API Resource'ların toIso8601String çıktısı).
     */
    server_time: string
    resources: ResourceResult[]
  }
  meta: Meta
}
export interface ResourceResult {
  /**
   * Senkron kaynak adı. /api/v1 sonrasındaki yolun parametresiz bölümlerinin '.' ile birleşimidir: 'parties', 'items.variants', 'treasury-reports.receivables-ageing'.
   */
  resource: string
  rows: ResourceRow[]
  tombstones: Tombstone[]
  next_cursor: Cursor
  has_more: boolean
  /**
   * true ise istemci bu kaynağın yerel kopyasını siler ve rows'u yeni tam indirmenin ilk sayfası olarak uygular.
   */
  reset: boolean
  /**
   * cursor_expired: cursor.txid, şirketin tombstone tabanından (tombstone_floor_txid) küçük. visibility_changed: cursor.gen güncel görünürlük nesline eşit değil. schema_changed: kaynağın Resource şekli uyumsuz değişti.
   */
  reset_reason?: 'cursor_expired' | 'visibility_changed' | 'schema_changed'
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
 * Tombstone. Senkronlanan bir satırın istemciden kaldırılması gerektiğini bildirir. deleted/soft_deleted: sync_tombstones tablosundaki satırın tel biçimi; 90 gün saklanır. out_of_scope: tabloda saklanmaz; konumu cursor aralığında olan ama artık kaynağın penceresine uymayan canlı satır için pull sırasında üretilir.
 */
export interface Tombstone {
  /**
   * Senkron kaynak adı. /api/v1 sonrasındaki yolun parametresiz bölümlerinin '.' ile birleşimidir: 'parties', 'items.variants', 'treasury-reports.receivables-ageing'.
   */
  resource: string
  /**
   * Küçük harfli kanonik UUID (herhangi bir sürüm). Sunucunun ürettiği satır kimlikleri için.
   */
  id: string
  /**
   * Alt kaynaklarda (ör. items.variants) üst kaydın kimliği.
   */
  parent_id?: string | null
  /**
   * PostgreSQL xid8 değeri (pg_current_xact_id). 64 bit olduğu için ondalık string olarak taşınır; JavaScript sayısına çevrilmez.
   */
  sync_txid: string
  /**
   * ISO 8601 zaman damgası, saat dilimi ofsetiyle (API Resource'ların toIso8601String çıktısı).
   */
  deleted_at: string
  /**
   * deleted: satır fiziksel olarak silindi. soft_deleted: deleted_at dolduruldu (SoftDeletes). out_of_scope: satır değişti ve window_field değeri artık pencerenin dışında (ör. belge tarihi geriye alındı). Değişmeden yaşlanarak pencereden çıkan belgeler tombstone üretmez; istemci onları kendi bildiği window_field değerine göre budar.
   */
  reason: 'deleted' | 'soft_deleted' | 'out_of_scope'
}
/**
 * Bir sonraki istekte gönderilecek cursor. has_more=false ise {txid: horizon, after_id: null, session: <akış etiketi>}. Tam indirmenin has_more=true sayfalarında session, indirme oturumunun opak kimliğidir; diğer tüm sayfalarda akış etiketidir. gen her zaman kaynağın güncel görünürlük neslidir; tam indirme sırasında nesil değişirse sonraki sayfa yeniden reset alır.
 */
export interface Cursor {
  /**
   * PostgreSQL xid8 değeri (pg_current_xact_id). 64 bit olduğu için ondalık string olarak taşınır; JavaScript sayısına çevrilmez.
   */
  txid: string
  after_id: string | null
  /**
   * Sunucuda (kullanıcı, şirket, kaynak) başına tutulan, görünürlüğü etkileyen her değişiklikte (rol, izin, şirket üyeliği, kapsam) artan sayaç. Tüketilen bir bayrak değildir; her cihaz kendi cursor'ındaki değeri bununla karşılaştırır.
   */
  gen: number
  /**
   * Sunucunun ürettiği opak değer. Tam indirmenin has_more=true sayfalarında oturum kimliği, diğer tüm sunucu cursor'larında akış etiketidir (i_ öneki). İstemci yorumlamaz, karşılaştırmaz, üretmez; cursor ile aynen geri gönderir. Oturum/etiket bu kullanıcı, şirket, kaynak ve konum için geçerli değilse kaynak reset (cursor_expired) alır. Dolu cursor ile null session eski istemci sayılır ve bir kez reset alır; ilk indirme cursor: null ile başlar.
   */
  session: string | null
}
/**
 * Başarılı yanıtın meta nesnesi. Senkron uçları ek alan koymaz; ileride eklenebilir.
 */
export interface Meta {
  [k: string]: unknown
}
