# Senkron Protokolü

Masaüstü istemcinin sunucuyla veri alışverişini tanımlar: kapsam manifesti, artımlı okuma (pull), outbox gönderimi (push), çakışma kuralları, cihaz kimliği ve saklama süreleri. Sunucu tarafı web reposunda `Modules/Sync` olarak yaşar; masaüstü reposu bu sözleşmeleri upstream'den aynen alır.

Kararların gerekçeleri:

- [ADR 0004](adr/0004-sync-xid-watermark.md): xid watermark ile pull
- [ADR 0005](adr/0005-sync-push-and-conflicts.md): push sonuçları ve çakışma kuralları
- [ADR 0006](adr/0006-offline-manifest.md): offline-manifest ve ONLINE_ONLY
- [ADR 0007](adr/0007-device-tokens.md): cihaz token'ları

## Sözleşme dosyaları

Tüm şemalar JSON Schema draft 2020-12'dir. Tel tipleri bu şemalardan üretilir: Rust için `typify`, TypeScript için `json-schema-to-typescript`. PHP testleri sunucu yanıtlarını aynı şemalara karşı doğrular.

| Dosya | İçerik |
|---|---|
| `contracts/offline-manifest.json` | Hangi kaynağın nasıl okunup yazılabildiği, ONLINE_ONLY işlemler. Sunucu ve Rust aynı dosyayı okur. |
| `contracts/offline-manifest.schema.json` | Manifestin şeması. |
| `contracts/sync/common.schema.json` | Ortak tanımlar: `uuid`, `uuidv7`, `xid8`, `cursor`, `visibilityGeneration`, `scope`, `resourceName`, `timestamp`, `requires`, `apiError`, `resourceRow`. |
| `contracts/sync/manifest.response.schema.json` | `GET /api/v1/sync/manifest` yanıtı. |
| `contracts/sync/pull.request.schema.json` | `POST /api/v1/sync/pull` isteği. |
| `contracts/sync/pull.response.schema.json` | `POST /api/v1/sync/pull` yanıtı. |
| `contracts/sync/push.request.schema.json` | `POST /api/v1/sync/push` isteği. |
| `contracts/sync/push.response.schema.json` | `POST /api/v1/sync/push` yanıtı. |
| `contracts/sync/tombstone.schema.json` | Silinen satır bildirimi. |
| `contracts/sync/error-codes.schema.json` | `errors.code` değerleri (mevcut `ErrorCode` + önerilen senkron kodları). |
| `contracts/sync/error.response.schema.json` | İstek düzeyindeki hata zarfı. |
| `contracts/sync/fixtures/` | Her şema için geçerli örnekler; `fixtures/invalid/` şemanın reddetmesi gereken örnekler. Dosya adı `<şema>.<durum>.json`. |

Şema `$id` değerleri `https://keystone-erp.invalid/contracts/...` biçimindedir. Bu adres çözülmez; yalnızca dosyalar arası `$ref` için taban URI'dir.

Şemanın ifade edemediği kurallar (alan kümesi eşitliği, sürüm karşılaştırması, saklanan sonuçlar) bu belgede **sunucu kuralı** olarak tanımlıdır ve Pest testleriyle zorlanır.

## Genel kurallar

- Uçlar `/api/v1` altındadır. Başarılı yanıt `{data, meta}`, hata `{errors:{message, code, fields?}}` biçimindedir (`docs/ENGINEERING-RULES.md`).
- Kimlik doğrulama `Authorization: Bearer <cihaz token'ı>` ile yapılır; token'ın `desktop` yeteneği olmalıdır. Şirket `X-Company-Id` başlığıyla seçilir (`company` middleware'i). Senkron uçları `auth:sanctum`, `password.changed` ve `company` middleware'lerinin arkasındadır.
- Her senkron durumu (cursor, outbox, yerel depo) **kullanıcı + şirket** çiftine bağlıdır. Şirket değişince başka bir yerel veri kümesine geçilir.
- `xid8` değerleri 64 bittir ve **ondalık string** olarak taşınır. JavaScript sayısına çevrilmez.
- Zaman damgaları API Resource'lardaki gibi ISO 8601 ve ofsetlidir.

### Kaynak adları

Kaynak adı, `/api/v1` sonrasındaki gerçek route yolunun parametresiz bölümlerinin `.` ile birleşimidir:

| Route | Kaynak adı |
|---|---|
| `/api/v1/parties` | `parties` |
| `/api/v1/items/{item}/variants` | `items.variants` |
| `/api/v1/price-lists/{priceList}/lines` | `price-lists.lines` |
| `/api/v1/warehouses/{warehouse}/locations` | `warehouses.locations` |
| `/api/v1/treasury-reports/receivables-ageing` | `treasury-reports.receivables-ageing` |

Manifestte yalnızca backend'de gerçekten tanımlı route'lar bulunur. Yeni bir kaynak, önce REST ucu ve API Resource'u ile web'e girer, sonra manifeste eklenir.

### Kapsam (`scope`)

Her manifest kaynağı bir şirket kapsamı bildirir. Kapsam, modelin backend'deki gerçek davranışını izler:

| `scope` | Kaynaklar | Satır kümesi |
|---|---|---|
| `company` | Varsayılan; Parties, Catalog, Inventory, Sales, Purchasing ve Reference'ın şirkete ait tabloları | `company_id = :company` |
| `company_or_global` | `exchange-rates`, `tax-codes` | `company_id IS NULL OR company_id = :company`. `NULL` satırlar sistem satırıdır (TCMB kurları, resmî vergi kodları); `ExchangeRate` ve `TaxCode` global scope'larıyla aynıdır. |
| `global_with_company_activation` | `currencies` | Tüm `currencies` satırları; şirkete özel durum `company_currencies` (`activation.key = currency_code`). |

`global_with_company_activation` kaynaklarında her iki tablo da syncable'dır. Bir satırın akıştaki konumu `(greatest(currencies.sync_txid, company_currencies.sync_txid), currencies.id)` olarak hesaplanır; böylece yalnızca aktivasyon değiştiğinde de satır yeniden yayılır ve bir şirketin aktivasyonu başka şirketin akışına sızmaz. Satır, `ReferenceResource`'un şirket alanlarıyla (`company_is_active`, `company_version`) döner.

Global satırlar (`company_id IS NULL` ya da `currencies`) çevrimdışı yazılamaz; `write` tanımlı kaynakların kapsamı `company` olmak zorundadır (şema denetler).

### Satır şekli

Pull ve push yanıtlarındaki satırlar, kaynağın REST ucunun döndürdüğü **API Resource JSON'u ile birebir aynıdır** (manifestteki `api_resource`). Ayrı bir senkron DTO'su yoktur. Sözleşme yalnızca `id` alanını şart koşar; geri kalan şekil OpenAPI'deki ilgili Resource şemasıdır. `embeds` ile listelenen ilişkiler (`lines`, `addresses`, `units` gibi) hem pull satırlarında hem push `data`'sında yüklenmiş olarak gelir. İstemci yerel satırı bu JSON ile tümüyle değiştirir; bu yüzden ilişkisi yüklenmemiş bir Resource çıktısı döndürmek sözleşme ihlalidir.

## GET /api/v1/sync/manifest

Etkin şirket ve kullanıcı için senkron kapsamını döner. Şema: `manifest.response.schema.json`.

- `resources`: `offline-manifest.json` kaynaklarının ve alt akışlarının (`children`) kullanıcının izinleriyle süzülmüş listesi. İzin, `requires.any_of` (biri yeterli) ve `requires.all_of` (hepsi gerekli) ile değerlendirilir. `writable`, kullanıcının yetkili olduğu yazma işlemleridir (`create`, `update`, `delete`, `action:<ad>`). `visibility_generation`, kaynağın güncel görünürlük neslidir.
- `permissions`: etkin şirketteki etkin izinler. İstemci butonları bu listeye göre gösterir.
- `online_only`: kullanıcının yetkili olduğu ama çevrimdışıyken devre dışı kalacak işlemlerin anahtarları.
- `schema_version` / `min_schema_version`: istemcinin `schema_version` değeri bu aralıkta değilse pull ve push `SYNC_SCHEMA_MISMATCH` döner.
- `limits`: sayfa ve parti sınırları, saklama süreleri.

İstemci manifesti oturum açılışında, şirket değişiminde ve her senkron turunun başında alır. Önceki manifestte olup yenisinde olmayan bir kaynak yerelden silinir (izin kaybı).

## POST /api/v1/sync/pull

Kaynak başına cursor ile artımlı okuma. Şemalar: `pull.request.schema.json`, `pull.response.schema.json`.

### Değişiklik izleme

Senkronlanan her tabloda `sync_txid xid8` kolonu vardır. `BEFORE INSERT OR UPDATE` trigger'ı bu kolona `pg_current_xact_id()` yazar. Silme ve soft delete (`deleted_at` dolması), `sync_tombstones` tablosuna `(resource, id)` başına **tek satır** olarak upsert edilir; tombstone'un `sync_txid`'i son silmenin transaction'ıdır. Soft delete'in geri alınması (restore) satırın `sync_txid`'ini yeniler ve aynı trigger tombstone'u siler. Bunlar A6 `syncable()` migration makrosunun işidir (bkz. Açık konular).

### Olay akışı ve tekilleştirme

Kaynak başına olaylar, sayfalamadan **önce** tekilleştirilmiş tek bir akıştır:

- **Canlı satır olayı:** `deleted_at IS NULL` olan satır, konumu `(sync_txid, id)`.
- **Tombstone olayı:** `sync_tombstones` satırı, konumu `(sync_txid, id)`; yalnızca aynı `id` için canlı satır yoksa. Canlı satır varsa tombstone hiç okunmaz.

Tombstone `(resource, id)` için tekil olduğundan ve canlı satır her zaman tombstone'a üstün geldiğinden, akışta her `id` en fazla bir kez bulunur. Aynı transaction'da silinip geri alınan kayıt canlı satır olarak görünür. Bu yüzden keyset ve `LIMIT` belirsizlik olmadan uygulanır ve bir sayfada aynı `id` iki kez geçmez.

### Sorgu

Her istek için sunucu önce horizon alır:

```sql
SELECT pg_snapshot_xmin(pg_current_snapshot()) AS horizon;
```

Horizon'un altındaki tüm transaction'lar tamamlanmıştır. Bu yüzden `sync_txid < horizon` olan bir olay daha sonra daha küçük bir `sync_txid` ile ortaya çıkmaz ve olay atlanmaz. Global kilit veya sayaç satırı yoktur; web yazmaları yavaşlamaz.

```sql
-- olaylar = canlı satırlar ∪ (canlı satırı olmayan tombstone'lar), kapsam koşuluyla (Kapsam bölümü)
-- cursor.after_id null ise:
WHERE pos_txid >= :txid AND pos_txid < :horizon
-- cursor.after_id doluysa:
WHERE (pos_txid, id) > (:txid, :after_id) AND pos_txid < :horizon
ORDER BY pos_txid, id
LIMIT :limit + 1
```

- İlk indirmede `cursor: null` gönderilir; sunucu `{txid: "0", after_id: null, gen: <güncel nesil>}` kabul eder.
- `has_more = true` ise `next_cursor`, sayfadaki son olayın konumudur. `has_more = false` ise `next_cursor = {txid: horizon, after_id: null}`.
- `next_cursor.gen` her zaman kaynağın güncel görünürlük neslidir.
- İstemci sayfaları sırayla uygular ve `next_cursor`'ı sayfayı yerel depoya yazdığı transaction içinde saklar.
- Satırlar policy ve şirket kapsamından geçer. Kullanıcının göremediği satır dönmez.
- `window_days` tanımlı kaynaklarda yalnızca `window_field` değeri pencere içinde olan satırlar döner. Pencereden çıkan belgeler için tombstone üretilmez; istemci yerel kopyayı aynı kurala göre kendisi budar.

### Görünürlük nesli

Görünürlük, sunucuda `(user_id, company_id, resource)` başına tutulan bir **görünürlük nesli** sayacıyla izlenir. Rol ataması, rol izinleri, şirket üyeliği veya kaynağın kapsamını etkileyen ayar değiştiğinde ilgili kullanıcıların etkilenen kaynaklardaki nesli bir artar.

- Nesil tüketilen bir bayrak değildir. Her cihaz kendi cursor'ındaki `gen` değerini sunucunun güncel nesliyle karşılaştırır; bir cihazın reset alması diğer cihazların durumunu değiştirmez.
- `cursor.gen` güncel nesilden farklıysa sunucu o kaynak için `reset: true, reset_reason: visibility_changed` döner. `rows`, yeni tam indirmenin ilk sayfasıdır ve `next_cursor.gen` güncel nesildir.
- Tam indirme sayfalanırken nesil yeniden değişirse, eski `gen` taşıyan sonraki sayfa tekrar reset alır. Böylece hiçbir cihaz eski görünürlükle başlamış bir indirmeyi yeni görünürlükle tamamlamaz.

### Reset

`reset: true` dönen kaynakta istemci yerel kopyayı siler ve aynı yanıttaki `rows`'u yeni tam indirmenin ilk sayfası olarak uygular. Bu kaynağa ait bekleyen outbox kayıtları silinmez; push sırasında normal kurallarla değerlendirilir.

| `reset_reason` | Ne zaman |
|---|---|
| `cursor_expired` | `cursor.txid`, şirketin **tombstone tabanından** küçük. |
| `visibility_changed` | `cursor.gen`, güncel görünürlük nesline eşit değil. |
| `schema_changed` | Kaynağın API Resource şekli uyumsuz değişti. |

**Tombstone tabanı.** `xid8` değerinden yaş hesaplanamaz. Bu yüzden tombstone temizliği (90 günden eski `deleted_at`) silinen tombstone'ların en büyük `sync_txid` değerini `(company_id, resource)` başına `tombstone_floor_txid` olarak saklar; taban yalnızca büyür. `cursor.txid < tombstone_floor_txid` olan cursor, aradaki bir silmeyi kaçırmış olabilir ve `cursor_expired` alır. İlk indirme (`cursor: null`) tabandan etkilenmez.

### Anlık görüntü kaynakları

`source: snapshot` olan kaynaklar (`stock-balances`, `treasury-reports.receivables-ageing`, `treasury-reports.payables-ageing`) pull ile değil, kendi REST uçlarından tümüyle alınır. Bunlar syncable tablo değildir; hesaplanmış raporlardır. İstemci bunları `snapshot_refresh_minutes` aralığında yeniler, alındığı zamanla saklar ve yalnızca çevrimdışıyken "şu tarih itibarıyla" etiketiyle gösterir (`read: offline-fallback`).

## POST /api/v1/sync/push

Outbox'tan partilenmiş mutasyonlar. Şemalar: `push.request.schema.json`, `push.response.schema.json`.

### Mutasyon

```json
{
  "idempotency_key": "UUIDv7",
  "op": "create | update | delete | action",
  "action": "counts",
  "resource": "sales-quotes",
  "id": "UUIDv7",
  "parent_id": "UUID (alt kaynaklarda)",
  "base_version": 4,
  "changed_fields": ["notes"],
  "occurred_at": "2026-10-25T18:05:40+03:00",
  "payload": { "notes": "..." },
  "depends_on": ["UUIDv7"],
  "resolution": { "resolves": "UUIDv7", "code": "DUPLICATE_RECORD", "choice": "keep_mine" }
}
```

- `id` istemcinin ürettiği UUIDv7'dir ve sunucuda doğrudan birincil anahtar olur. `client_id`/`server_id` ikiliği yoktur.
- `payload`, manifestteki `write.ops[].route` ucunun FormRequest girdisidir, **`version` hariç** (şema `version` anahtarını reddeder). Örnek: sayım girişi `PATCH /stock-documents/{id}/counts` için `{"counts": [{"line_id": "…", "counted_quantity": "38"}]}` (`CountsRequest`).
- `base_version` create için `null`, diğerleri için değişikliğin dayandığı sunucu sürümüdür.

### Alan kümesi (`changed_fields`)

- `update` ve `action`: `changed_fields` **payload'ın üst düzey anahtar kümesine birebir eşit** olmalıdır. Sunucu bunu doğrular; eşit değilse `rejected` / `SYNC_CHANGED_FIELDS_MISMATCH`. Çakışma kontrolü ve uygulanan alanlar her zaman bu doğrulanmış kümedir; payload'da bildirilmemiş alan uygulanamaz.
- Dizi alanları (`lines`, `counts`, `billing_address`) tek alan sayılır ve bütün olarak yazılır.
- `create` ve `delete`: `changed_fields` boştur; `delete` payload'ı boş nesnedir (şema denetler).

### Sürüm kontrolü

Manifestteki her işlem `version_check` bildirir:

| `version_check` | İşlem | Kural |
|---|---|---|
| `none` | `create` | Sürüm yok. Aynı `id` zaten varsa `rejected` / `VALIDATION_ERROR` (`fields.id`). |
| `field-merge` | `update` | Aşağıdaki çakışma kuralları 2-4. |
| `exact` | `delete`, `action` | `base_version` sunucu sürümüne **eşit** olmalıdır; değilse `conflict` / `VERSION_CONFLICT` (alan kesişimi aranmaz). |

Her işlem için: `base_version` sunucu sürümünden **büyükse** `rejected` / `SYNC_BASE_VERSION_AHEAD`; istemci kaydı yeniden indirir.

**REST sürüm parametresine çeviri.** Sunucu hedef satırı `SELECT … FOR UPDATE` ile kilitler ve sürüm kontrolünü bu kilit altında yapar. REST ucuna giden `version` değeri:

- `exact`: `base_version` (kilit altında sunucu sürümüne eşit olduğu doğrulanmıştır).
- `field-merge`, `base_version` güncel: `base_version`.
- `field-merge`, `base_version` eski ama kesişim yok: kilit altında okunan **güncel sunucu sürümü**. Kilit, kontrol ile yazma arasında başka bir yazmayı engeller; `HasVersion` karşılaştır-ve-değiştir yine çalışır ve beklenmedik bir `VERSION_CONFLICT` olursa sonuç `conflict` olarak döner.

### İşleme

1. İstek düzeyi kontroller: token, şirket, `schema_version`, parti boyutu (`limits.push_batch_max`). Hata varsa tüm istek `error.response.schema.json` biçiminde döner.
2. Mutasyonlar **sırayla** ve her biri **kendi transaction'ında** işlenir. Parti atomik değildir.
3. **Idempotency.** `(kullanıcı, şirket, 'sync.push', idempotency_key)` için saklanan bir sonuç varsa mutasyon yeniden çalıştırılmaz:
   - İstek özeti farklıysa `rejected` / `IDEMPOTENCY_KEY_REUSED`.
   - Saklanan sonuç `applied` ise `duplicate` döner; ilk sonucun `version` ve `data`'sı aynen, `replayed: true`.
   - Saklanan sonuç `conflict` veya `rejected` ise **aynı statü ve aynı gövdeyle** döner, `replayed: true`. Böylece tekrar gönderim bir çakışmayı başarı gibi göstermez.
   Sonucun tamamı 7 gün saklanır. Geçici hatalar (aşağıda) saklanmaz.
4. **Bağımlılık.** Aynı `id`'ye ait önceki mutasyonlar ve `depends_on` ile bildirilenler `applied` veya `duplicate` olmalıdır; değilse `rejected` / `SYNC_DEPENDENCY_FAILED` ve mutasyon denenmez. `depends_on` yalnızca aynı partide **daha önce** gelen ya da önceki bir partide gönderilmiş (sonucu saklı) anahtarlara işaret edebilir; ileri veya bilinmeyen referans `rejected` / `VALIDATION_ERROR` (`fields.depends_on`) olur. Referanslar yalnızca geriye baktığı için döngü oluşamaz.
5. **Manifest kontrolü.** Kaynak, `op`/`action`, izin, `payload_constraints` (create ve update payload'ı) manifestteki `write` tanımıyla karşılaştırılır. Tanım dışıysa `rejected` / `SYNC_OFFLINE_WRITE_NOT_ALLOWED`. Varsayılan kural reddir; manifestte tanımlı olmayan her yazma ONLINE_ONLY'dir.
6. **Hedef kontrolü** (update, delete, action). Hedef satır kilit altında okunur:
   - `target_constraints` sağlanmıyorsa `rejected` / `SYNC_OFFLINE_WRITE_NOT_ALLOWED`. Örnek: `stock-documents` için hedefin `doc_type` değeri `count` olmalıdır; başka türdeki taslak çevrimdışı güncellenemez, silinemez ve sayılamaz.
   - `draft_only` sağlanmıyorsa `conflict` / `DOCUMENT_LOCKED`.
   - Sürüm kontrolü (yukarıda).
7. Mutasyon ilgili REST ucunun **FormRequest → Policy → Service** zincirinden geçirilir. Senkron için ayrı iş kuralı yazılmaz.

### Sonuçlar

| `status` | Anlamı | Zorunlu alanlar | İstemci |
|---|---|---|---|
| `applied` | Bu istekte uygulandı. | `data`; `data` doluysa `version`; kesişimsiz birleştirmede `merged_fields`. `replayed: false`. | Outbox kaydını siler, yerel satırı `data` ile değiştirir; `data: null` (delete) ise yerel satırı siler. |
| `duplicate` | Daha önce `applied` olmuş anahtarın tekrarı. | `applied` ile aynı; `replayed: true`. | `applied` gibi davranır. |
| `conflict` | Kullanıcı kararı gerekir. | `conflict`. | Kaydı Conflict Inbox'a taşır. |
| `rejected` | Kalıcı hata. | `error`. | Outbox kaydını hata koduyla işaretler, kullanıcıya gösterir. |

Geçici hatalarda (ağ, 5xx, `TOO_MANY_ATTEMPTS`, `IDEMPOTENCY_IN_PROGRESS`) sonuç yoktur; istemci partiyi aynı anahtarlarla geri çekilerek yeniden gönderir.

### Çakışma kuralları

Sessiz üzerine yazma yasaktır.

1. **Belge kilitli.** `write.draft_only` alanı (`status`) artık `draft` değilse sonuç `conflict` / `DOCUMENT_LOCKED` olur. Seçenekler yalnızca `save_as_new_draft` (istemci yeni UUIDv7 ve yeni anahtarla `create` üretir) veya `discard` (şema denetler).
2. **Eski sürüm, kesişim yok** (`field-merge`). `base_version` güncel değilse, doğrulanmış `changed_fields` ile `base_version`'dan beri sunucuda değişen alanlar (audit diff) karşılaştırılır. Kesişim yoksa değişiklik uygulanır: `applied` ve `merged_fields`.
3. **Eski sürüm, kesişim var.** Sonuç `conflict` / `VERSION_CONFLICT`; `conflicting_fields` ve `server_data` döner. Seçenekler `keep_mine`, `take_server`, `merge` içinden. `delete`/`action` için `exact` kuralı gereği kesişim aranmaz; seçenekler `keep_mine` ve `take_server`.
4. **Belirsizlik çakışmadır.** Aradaki değişikliği audit kaydından kesin çıkarılamayan alan (ör. activitylog'un izlemediği `lines`) kesişiyor sayılır.
5. **Mükerrer cari.** `parties` create'i öncesinde sunucu `GET /api/v1/parties/duplicates` ile aynı aramayı yapar. Aday varsa `conflict` / `DUPLICATE_RECORD` ve `candidates` döner. Seçenekler `use_existing` (istemci yerel taslağı aday kayda bağlar; sunucuya yazma yok), `keep_mine`, `discard`.

### Çakışma çözümü (`resolution`)

Conflict Inbox kararı, **yeni bir `idempotency_key`** ile gönderilen yeni bir mutasyondur; `resolution.resolves` çözülen conflict sonucunun anahtarını taşır. Sunucu saklanan conflict sonucunu aynı kullanıcı, şirket, kaynak ve `id` için arar; bulamazsa veya seçim o çakışma türünde geçersizse `rejected` / `SYNC_RESOLUTION_INVALID`.

| Çakışma | Seçim | Yeni mutasyon |
|---|---|---|
| `VERSION_CONFLICT` | `keep_mine` | Aynı `op`, `base_version = server_version`, kullanıcının alanları; `resolution` `{code: VERSION_CONFLICT, choice: keep_mine}`. |
| `VERSION_CONFLICT` | `merge` | `update`, `base_version = server_version`, birleştirilmiş alanlar; `resolution.choice = merge`. |
| `VERSION_CONFLICT` | `take_server` | Mutasyon yok; istemci `server_data`'yı uygular. |
| `DOCUMENT_LOCKED` | `save_as_new_draft` | Yeni `id` ile `create`; `resolution` gerekmez. |
| `DUPLICATE_RECORD` | `keep_mine` | Aynı `id` ile `create`; `resolution` `{code: DUPLICATE_RECORD, choice: keep_mine}`. Sunucu bu durumda mükerrer kontrolünü atlar; diğer doğrulamalar ve `parties.create` izni aynen uygulanır. |
| `DUPLICATE_RECORD` | `use_existing` | Mutasyon yok; bağımlı outbox kayıtları istemcide aday `id`'ye yeniden yazılır. |
| Herhangi | `discard` | Mutasyon yok; outbox kaydı silinir. |

Numara verme sunucudadır. Çevrimdışı oluşturulan taslak numarasızdır; numara push uygulandığında `data.number` ile gelir.

## Okuma modları

| `read` | Davranış |
|---|---|
| `local-first` | Ekran her zaman yerel depodan okur; pull arka planda tazeler. Ana veriler ve çevrimdışı yazılabilen belgeler. |
| `online-first` | Önce ağ (kısa zaman aşımı); başarısızsa yerel kopya "eski olabilir" etiketiyle gösterilir. Son 30 günün salt okunur belgeleri. |
| `offline-fallback` | Çevrimiçiyken yalnızca ağ. Yerel anlık görüntü yalnızca çevrimdışıyken, alındığı zamanla etiketli gösterilir. Bakiyeler. |

`write` tanımlı her kaynak `local-first` olmak zorundadır (şema bunu denetler).

## Çevrimdışı yazma kapsamı

| Kaynak | İşlemler (`version_check`) | Kısıt |
|---|---|---|
| `parties` | create (`none`) | Mükerrer kontrolü (`DUPLICATE_RECORD`). |
| `sales-quotes` | create (`none`), update (`field-merge`), delete (`exact`) | Hedef `status = draft`. |
| `sales-orders` | create, update, delete | Hedef `status = draft`. |
| `purchase-requests` | create, update, delete | Hedef `status = draft`. |
| `stock-documents` | create, update, delete, action `counts` (`exact`) | Payload ve hedef `doc_type = count`; hedef `status = draft`. |

## ONLINE_ONLY

`offline-manifest.json` içindeki `online_only` listesi, çevrimdışıyken devre dışı görünen işlemleri ve karşılık gelen gerçek route'ları tanımlar. Butonlar `desktop.onlineOnly.<action>` tooltip'ini gösterir. Kategoriler: kesinleştirme (`finalize`), onay (`approve`), ödeme/tahsilat (`payment`), stok düşümü/girişi (`stock`), e-Belge (`edocument`), dönem kapanışı (`period-close`), sunucu hesabı (`server-calculation`: toplam önizleme, fiyat çözümleme, risk) ve canlı raporlar (`live-report`). Gerekçe: boşluksuz numara, risk limiti, stok rezervasyonu ve defter bütünlüğü sunucuda kalır.

Liste UI etiketi içindir; güvenlik sınırı değildir. Sunucu, manifestte `write` tanımı olmayan her push mutasyonunu zaten reddeder.

## Hata kodları

İlk 22 kod `backend/app/Core/Http/ErrorCode.php` ile aynıdır. Aşağıdakiler senkron için önerilen yeni durumlardır; `ErrorCode` enum'una, `status()` eşlemesine ve `lang/*/errors.php` çevirilerine eklenmelidir.

| Kod | HTTP | Nerede |
|---|---|---|
| `DOCUMENT_LOCKED` | 409 | Push `conflict`. Hedef belge taslak değil. |
| `DUPLICATE_RECORD` | 409 | Push `conflict`. Mükerrer cari adayı. |
| `SYNC_SCHEMA_MISMATCH` | 409 | İstek. İstemci şema sürümü desteklenmiyor. |
| `SYNC_CURSOR_INVALID` | 422 | İstek. Cursor biçimsiz, horizon'dan ileride ya da `gen` güncel nesilden büyük. |
| `SYNC_RESOURCE_UNSUPPORTED` | 422 | İstek veya push `rejected`. Kaynak manifestte yok. |
| `SYNC_OFFLINE_WRITE_NOT_ALLOWED` | 422 | Push `rejected`. Mutasyon `write` tanımının ya da hedef kısıtlarının dışında. |
| `SYNC_BATCH_TOO_LARGE` | 413 | İstek. Kaynak veya mutasyon sayısı limitin üstünde. |
| `SYNC_DEPENDENCY_FAILED` | — | Push `rejected`. Bağımlı olunan mutasyon başarısız. |
| `SYNC_BASE_VERSION_AHEAD` | — | Push `rejected`. `base_version` sunucu sürümünden büyük. |
| `SYNC_CHANGED_FIELDS_MISMATCH` | — | Push `rejected`. `changed_fields` payload anahtarlarına eşit değil. |
| `SYNC_RESOLUTION_INVALID` | — | Push `rejected`. `resolution` saklanan bir çakışmaya karşılık gelmiyor. |

"—" olan kodlar yalnızca push sonucu içinde döner; HTTP durumu 200'dür. Push sonuçlarında mevcut kodlar da kullanılır: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE_TRANSITION`, `APPROVAL_REQUIRED`, `IDEMPOTENCY_KEY_REUSED`. İzin kaybı `FORBIDDEN`, iptal edilmiş cihaz `UNAUTHENTICATED` döner.

## Cihaz kimliği

- `POST /api/v1/auth/device`: e-posta, parola, TOTP (2FA açıksa), `device_name`, `fingerprint`. `desktop` yetenekli Sanctum token'ı verir; token cihaza (`user_devices`) bağlıdır.
- `GET /api/v1/me/devices` ve `DELETE /api/v1/me/devices/{id}`: cihazları listeler ve iptal eder.
- Pasifleştirme, parola değişimi ve yönetici sıfırlaması cihaz token'larını iptal eder (`AccessRevoker`).
- Hedef: kısa ömürlü erişim token'ı ve döndürülerek yenilenen refresh token (ADR 0007). Uç sözleşmesi D1 açık konusudur (aşağıda madde 12).

## Saklama ve limitler

| Değer | Süre / sınır |
|---|---|
| Tombstone | 90 gün (`deleted_at`'e göre). Temizlik `tombstone_floor_txid`'i yükseltir; daha eski cursor `reset: cursor_expired` alır. |
| Push idempotency kaydı | 7 gün (`sync.push` kapsamı); istek özeti ve sonucun tamamı. |
| Görünürlük nesli | Süresiz; yalnızca artar. |
| Pull sayfası | Varsayılan 200, en fazla 1000 satır. |
| Pull isteğindeki kaynak sayısı | `limits.pull_resources_max` |
| Push partisi | `limits.push_batch_max`; şema üst sınırı 500. |
| Belge penceresi | 30 gün (`defaults.recent_window_days`). |

Uzun süren transaction'lar horizon'u geride tutar ve yalnızca senkronu geciktirir. `now - en eski açık transaction` metriği izlenir.

## Sürümleme

- `schema_version`: tel biçimi. Uyumsuz değişiklikte artar; sunucu `min_schema_version`'a kadar eski istemciyi destekler.
- `manifest_version`: `offline-manifest.json` içeriği. Her değişiklikte artar.
- API Resource şekline alan eklemek uyumludur. Alan silmek veya anlamını değiştirmek `schema_changed` reset'i gerektirir.

## Doğrulama

- Her şema 2020-12 meta-şemasına karşı derlenir; `offline-manifest.json` kendi şemasına karşı doğrulanır.
- `fixtures/*.json` şemasına karşı geçmeli, `fixtures/invalid/*.json` kalmalıdır; her geçersiz örnek belirli bir kuralı (konum + anahtar kelime) hedefler.
- Fixture'lardaki istek gövdeleri gerçek FormRequest'lerle, `data` örnekleri gerçek API Resource çıktısıyla aynı alanları taşır (ör. sayım `counts[].line_id`; `sales-quotes` ve `stock-documents` `data`'sı `lines` dahil).
- Sunucu testleri (Pest) pull/push yanıtlarını bu şemalara karşı ve bu belgedeki sunucu kurallarını (alan kümesi eşitliği, `exact` sürüm, saklanan sonuç tekrarı, hedef kısıtları, görünürlük nesli) doğrular; Rust testleri aynı fixture'ları deserialize eder.
- Manifestteki her route, backend route tanımlarında bulunmalıdır. Bu kontrol CI'da `php artisan route:list --json` çıktısına karşı yapılmalıdır.

## Açık konular

Web'de hazırlanması planlanan A6 zemininin ve senkron sunucusunun backend'de henüz olmayan parçaları. Kontrol `backend/` kaynak kodu üzerinde yapıldı. "D1 açık konusu" olarak işaretlenenler, sözleşmesi bu belgede bilerek tamamlanmamış konulardır.

**Senkron altyapısı (A6)**

1. `syncable()` migration makrosu yok. Hiçbir tabloda `sync_txid` kolonu, index'i veya `pg_current_xact_id()` trigger'ı yok.
2. `sync_tombstones` tablosu ve silme/soft delete/restore trigger'ı yok. Manifestteki kaynakların çoğu `SoftDeletes` kullanıyor (`Party`, `Item`, `Unit`, `PriceList`, `ItemCategory`, `ItemVariant`, `DiscountRule`, Reference modelleri). Trigger tombstone'u `(resource, id)` başına upsert etmeli, restore'da silmeli.
3. `backend/app/Core/Sync/` dizini boş; `Modules/Sync` modülü ve `GET /sync/manifest`, `POST /sync/pull`, `POST /sync/push` uçları yok.
4. Gömülü ilişkiler (`parties` → `addresses`/`contacts`/`bank_accounts`, belgeler → `lines`, `items` → `units`) yalnızca üst satırın `sync_txid`'i değişirse yayılır. Alt satır yazmalarının üst satırı güncellediği doğrulanmalı (özellikle `parties/{party}/addresses` gibi ayrı alt uçlar). Değilse alt tablo trigger'ı üst satırı dokunmalı.
5. Görünürlük nesli tablosu ve artırma noktaları yok: rol ataması (`PUT /users/{id}/roles`), rol izinleri (`PATCH /roles/{role}`), kullanıcı durumu ve şirket üyeliği değişiminde ilgili `(user, company, resource)` nesilleri artırılmalı.
6. `tombstone_floor_txid` deposu ve tombstone temizlik işi yok.
7. `currencies` + `company_currencies` için birleşik konum (`greatest(...)`) ve iki tabloya da `syncable()` gerekiyor; `exchange-rates` ve `tax-codes` sorgusu `company_id IS NULL` satırlarını içermeli.

**Push zinciri**

8. Store FormRequest'leri istemcinin gönderdiği `id`'yi kabul etmiyor. `HasUuid7` modelde istemci kimliğine izin veriyor, ama `parties`, `sales-quotes`, `sales-orders`, `purchase-requests` ve `stock-documents` için doğrulama kuralı (UUIDv7, benzersiz) eklenmeli.
9. `Idempotency-Key` saklama süresi 24 saat (`config/idempotency.php`, `IDEMPOTENCY_TTL_HOURS`) ve mevcut katman HTTP yanıtını saklıyor. Push için mutasyon başına sonuç, istek özeti ve 7 günlük `sync.push` kapsamı gerekli.
10. Taslak olmayan belgeyi düzenleme bugün `INVALID_STATE_TRANSITION` (422, `document_not_editable`) döndürüyor. Push bunu `DOCUMENT_LOCKED`'a çevirmeli; önerilen 11 kod `ErrorCode`'a eklenmeli.
11. `POST /api/v1/parties` mükerrer kontrolü yapmıyor; `DuplicateFinder` yalnızca `GET /api/v1/parties/duplicates` ucunda. Push create'i öncesinde çağrılmalı.
12. Alan bazlı birleştirme için audit diff yetersiz: activitylog `Party` için `version`'ı, `SalesDocument` için satırları kaydetmiyor. Kural 4 (belirsizlik çakışmadır) bu yüzden şart; daha iyi birleştirme için sürüm bazlı alan değişikliği kaydı gerekiyor.
13. Sunucu toplamları hesaplıyor (`preview-totals`). Çevrimdışı taslakta tutarlar geçicidir; push sonrası `data` ile kesinleşir.

**Cihaz kimliği**

14. **D1 açık konusu: refresh token sözleşmesi.** `POST /auth/device`, `GET /me/devices` ve `DELETE /me/devices/{id}` var; token tek ve 30 günlük (`DeviceTokens`: `sanctum.device_token_ttl_days` / `identity.device_tokens.ttl_days`). Gerekçe: yenileme bir Identity uç sözleşmesidir ve senkron tel biçimine değil OpenAPI'ye aittir; Identity değişikliğiyle birlikte şemalaştırılacak. D1'de bağlayıcı olacak çerçeve:
    - `POST /api/v1/auth/device/refresh`, gövde `{refresh_token, fingerprint}`, yanıt `{data: {token, expires_at, refresh_token, refresh_expires_at}}`.
    - Erişim token'ı 15 dakika, refresh token 30 gün (kayan). Her refresh yeni bir refresh token verir; eskisi tek kullanımlıktır.
    - Refresh token'lar `user_devices` kaydına bağlı bir **aile** oluşturur. Kullanılmış bir refresh token tekrar gelirse ailenin tamamı ve cihaz iptal edilir.
    - Eşzamanlı yenileme: aynı refresh token ile 30 saniye içinde gelen ikinci istek aynı yeni çifti alır (idempotent pencere); sonrası tekrar kullanım sayılır.
    - `DELETE /me/devices/{id}`, pasifleştirme, parola değişimi ve yönetici sıfırlaması aileyi iptal eder.

**Kapsam**

15. B3'teki çevrimdışı yazma türlerinden masraf beyanı, izin talebi, puantaj/zaman çizelgesi (İK, Faz 11) ile not ve aktivite için backend'de modül veya uç yok; manifestte yer almıyorlar.
16. ONLINE_ONLY listesindeki bordro ve MRP çalıştırma uçları yok (Faz 10 ve 11); eklenince manifeste girecek.
17. Cari bakiyesi için ayrı liste ucu yok. Anlık görüntü `treasury-reports/receivables-ageing` ve `payables-ageing` raporlarından alınıyor; `customers/{id}/exposure` cari başına ve çevrimiçi.
18. Depolar iki uçtan okunuyor: `warehouses` (Reference, ana veri) ve `stock-warehouses` (Inventory ayarları). Manifest ana veri olarak `warehouses`'ı kullanıyor.

**Frontend zemini (A6)**

19. `frontend/src/platform/` altında `http`, `connectivity`, `notify`, `realtime` var; `files` (kaydet/yazdır/aç) arayüzü yok.
20. Query key'ler `[resource, …]` standardında değil, modül köklü: `['parties', company]`, `['catalog', company, 'items', …]`, `['inventory', company, 'docs', …]`, `['reference', name, …]`. Senkron sonrası jenerik invalidation için ya key'ler standartlaştırılmalı ya da manifest kaynağı → key öneki eşlemesi tutulmalı.
21. Manifest route'larını `php artisan route:list --json` ile karşılaştıran ve fixture'ları şemalara karşı doğrulayan CI adımı yok.
