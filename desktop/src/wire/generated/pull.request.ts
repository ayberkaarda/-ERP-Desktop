// Do not edit: written by scripts/gen-wire-ts.mjs from contracts/.
// After a contract change run `npm run -w desktop wire:gen` and commit.

/**
 * POST /api/v1/sync/pull isteği. Kaynak başına cursor ile artımlı okuma. Şirket X-Company-Id başlığından gelir. Aynı kaynak bir istekte birden fazla geçemez (sunucu VALIDATION_ERROR döner).
 */
export interface PullRequest {
  /**
   * Senkron tel biçiminin sürümü. Uyumsuz değişiklikte artar.
   */
  schema_version: number
  /**
   * @minItems 1
   */
  resources: [
    {
      /**
       * Senkron kaynak adı. /api/v1 sonrasındaki yolun parametresiz bölümlerinin '.' ile birleşimidir: 'parties', 'items.variants', 'treasury-reports.receivables-ageing'.
       */
      resource: string
      /**
       * null: kaynağın ilk (tam) indirmesi.
       */
      cursor: Cursor | null
      /**
       * Sayfa boyutu; verilmezse limits.pull_page_default, en fazla limits.pull_page_max.
       */
      limit?: number
    },
    ...{
      /**
       * Senkron kaynak adı. /api/v1 sonrasındaki yolun parametresiz bölümlerinin '.' ile birleşimidir: 'parties', 'items.variants', 'treasury-reports.receivables-ageing'.
       */
      resource: string
      /**
       * null: kaynağın ilk (tam) indirmesi.
       */
      cursor: Cursor | null
      /**
       * Sayfa boyutu; verilmezse limits.pull_page_default, en fazla limits.pull_page_max.
       */
      limit?: number
    }[]
  ]
}
/**
 * Kaynak başına keyset konumu: (sync_txid, id), görünürlük nesli ve oturum ya da akış etiketi. after_id null ise sync_txid >= txid koşulu, değilse (sync_txid, id) > (txid, after_id) koşulu uygulanır. gen, sunucudaki (kullanıcı, şirket, kaynak) görünürlük neslinden farklıysa kaynak reset alır. session: bkz. cursorSession.
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
