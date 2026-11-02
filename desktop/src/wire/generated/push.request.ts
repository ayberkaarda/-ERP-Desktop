// Do not edit: written by scripts/gen-wire-ts.mjs from contracts/.
// After a contract change run `npm run -w desktop wire:gen` and commit.

export type Mutation = {
  /**
   * Outbox kaydıyla birlikte üretilir, yeniden denemelerde değişmez. Sunucuda (kullanıcı, şirket, 'sync.push') kapsamıyla, istek özeti ve sonucun tamamıyla 7 gün saklanır.
   */
  idempotency_key: string
  op: 'create' | 'update' | 'delete' | 'action'
  /**
   * op=action iken offline-manifest'teki write.ops[].action adı (ör. 'counts').
   */
  action?: string
  /**
   * Senkron kaynak adı. /api/v1 sonrasındaki yolun parametresiz bölümlerinin '.' ile birleşimidir: 'parties', 'items.variants', 'treasury-reports.receivables-ageing'.
   */
  resource: string
  /**
   * İstemcinin ürettiği UUIDv7. Sunucuda doğrudan birincil anahtar olur (ADR 0002).
   */
  id: string
  /**
   * Alt kaynak mutasyonlarında üst kaydın kimliği (ör. parties.addresses için party id).
   */
  parent_id?: string
  /**
   * Değişikliğin dayandığı sunucu sürümü. create için null. Sunucu bunu REST ucunun version parametresine kendisi çevirir; payload version içermez.
   */
  base_version: number | null
  /**
   * update/action: payload'ın üst düzey anahtar kümesiyle birebir aynı olmalıdır (sunucu doğrular, eşit değilse SYNC_CHANGED_FIELDS_MISMATCH). Çakışma karşılaştırması bu kümeyle yapılır; dizi alanları (lines, counts) tek alan sayılır. create: boş. delete: boş.
   */
  changed_fields: string[]
  /**
   * ISO 8601 zaman damgası, saat dilimi ofsetiyle (API Resource'ların toIso8601String çıktısı).
   */
  occurred_at: string
  /**
   * İlgili REST ucunun gövdesi (FormRequest girdisi), version hariç. delete için boş nesne.
   */
  payload: {
    [k: string]: unknown
  }
  /**
   * Bu mutasyondan önce applied/duplicate olması gereken başka mutasyonların idempotency_key'leri (ör. yeni cari, ona bağlı teklif). Aynı partide daha önce gelmeli ya da önceki bir partide gönderilmiş olmalıdır; ileri referans geçersizdir, bu yüzden döngü oluşamaz. Aynı id'ye ait önceki mutasyonlar örtük bağımlılıktır.
   *
   * @maxItems 50
   *
   * Items: İstemcinin ürettiği UUIDv7. Sunucuda doğrudan birincil anahtar olur (ADR 0002).
   */
  depends_on?: string[]
  resolution?: Resolution
} & {
  /**
   * Outbox kaydıyla birlikte üretilir, yeniden denemelerde değişmez. Sunucuda (kullanıcı, şirket, 'sync.push') kapsamıyla, istek özeti ve sonucun tamamıyla 7 gün saklanır.
   */
  idempotency_key: string
  op: 'create' | 'update' | 'delete' | 'action'
  /**
   * op=action iken offline-manifest'teki write.ops[].action adı (ör. 'counts').
   */
  action?: string
  /**
   * Senkron kaynak adı. /api/v1 sonrasındaki yolun parametresiz bölümlerinin '.' ile birleşimidir: 'parties', 'items.variants', 'treasury-reports.receivables-ageing'.
   */
  resource: string
  /**
   * İstemcinin ürettiği UUIDv7. Sunucuda doğrudan birincil anahtar olur (ADR 0002).
   */
  id: string
  /**
   * Alt kaynak mutasyonlarında üst kaydın kimliği (ör. parties.addresses için party id).
   */
  parent_id?: string
  /**
   * Değişikliğin dayandığı sunucu sürümü. create için null. Sunucu bunu REST ucunun version parametresine kendisi çevirir; payload version içermez.
   */
  base_version: number | null
  /**
   * update/action: payload'ın üst düzey anahtar kümesiyle birebir aynı olmalıdır (sunucu doğrular, eşit değilse SYNC_CHANGED_FIELDS_MISMATCH). Çakışma karşılaştırması bu kümeyle yapılır; dizi alanları (lines, counts) tek alan sayılır. create: boş. delete: boş.
   */
  changed_fields: string[]
  /**
   * ISO 8601 zaman damgası, saat dilimi ofsetiyle (API Resource'ların toIso8601String çıktısı).
   */
  occurred_at: string
  /**
   * İlgili REST ucunun gövdesi (FormRequest girdisi), version hariç. delete için boş nesne.
   */
  payload: {
    [k: string]: unknown
  }
  /**
   * Bu mutasyondan önce applied/duplicate olması gereken başka mutasyonların idempotency_key'leri (ör. yeni cari, ona bağlı teklif). Aynı partide daha önce gelmeli ya da önceki bir partide gönderilmiş olmalıdır; ileri referans geçersizdir, bu yüzden döngü oluşamaz. Aynı id'ye ait önceki mutasyonlar örtük bağımlılıktır.
   *
   * @maxItems 50
   *
   * Items: İstemcinin ürettiği UUIDv7. Sunucuda doğrudan birincil anahtar olur (ADR 0002).
   */
  depends_on?: string[]
  resolution?: Resolution
}
/**
 * Conflict Inbox kararı. Yeni bir idempotency_key ile gönderilir ve çözdüğü conflict sonucunu adresler.
 */
export type Resolution = {
  /**
   * İstemcinin ürettiği UUIDv7. Sunucuda doğrudan birincil anahtar olur (ADR 0002).
   */
  resolves: string
  code: 'VERSION_CONFLICT' | 'DUPLICATE_RECORD'
  choice: 'keep_mine' | 'merge'
}

/**
 * POST /api/v1/sync/push isteği. Outbox'tan partilenmiş mutasyonlar, oluşma sırasıyla. Her mutasyon kendi transaction'ında, FormRequest → Policy → Service zincirinden geçirilir; parti atomik değildir. Sunucu kuralları (changed_fields eşitliği, sürüm kontrolü, depends_on) docs/SYNC-PROTOCOL.md'dedir; şemanın ifade edemedikleri orada tanımlıdır.
 */
export interface PushRequest {
  /**
   * Senkron tel biçiminin sürümü. Uyumsuz değişiklikte artar.
   */
  schema_version: number
  /**
   * @minItems 1
   * @maxItems 500
   */
  mutations: [Mutation, ...Mutation[]]
}
