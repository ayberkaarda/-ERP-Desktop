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
| `contracts/sync/common.schema.json` | Ortak tanımlar: `uuid`, `uuidv7`, `xid8`, `cursor`, `resourceName`, `timestamp`, `requires`, `apiError`, `resourceRow`. |
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

### Satır şekli

Pull ve push yanıtlarındaki satırlar, kaynağın REST ucunun döndürdüğü **API Resource JSON'u ile birebir aynıdır** (manifestteki `api_resource`). Ayrı bir senkron DTO'su yoktur. Sözleşme yalnızca `id` alanını şart koşar; geri kalan şekil OpenAPI'deki ilgili Resource şemasıdır. `embeds` ile listelenen ilişkiler (`lines`, `addresses`, `units` gibi) pull satırlarında yüklenmiş olarak gelir.

## GET /api/v1/sync/manifest

Etkin şirket ve kullanıcı için senkron kapsamını döner. Şema: `manifest.response.schema.json`.

- `resources`: `offline-manifest.json` kaynaklarının ve alt akışlarının (`children`) kullanıcının izinleriyle süzülmüş listesi. İzin, `requires.any_of` (biri yeterli) ve `requires.all_of` (hepsi gerekli) ile değerlendirilir. `writable`, kullanıcının yetkili olduğu yazma işlemleridir (`create`, `update`, `delete`, `action:<ad>`).
- `permissions`: etkin şirketteki etkin izinler. İstemci butonları bu listeye göre gösterir.
- `online_only`: kullanıcının yetkili olduğu ama çevrimdışıyken devre dışı kalacak işlemlerin anahtarları.
- `schema_version` / `min_schema_version`: istemcinin `schema_version` değeri bu aralıkta değilse pull ve push `SYNC_SCHEMA_MISMATCH` döner.
- `limits`: sayfa ve parti sınırları, saklama süreleri.

İstemci manifesti oturum açılışında, şirket değişiminde ve her senkron turunun başında alır. Önceki manifestte olup yenisinde olmayan bir kaynak yerelden silinir (izin kaybı).

## POST /api/v1/sync/pull

Kaynak başına cursor ile artımlı okuma. Şemalar: `pull.request.schema.json`, `pull.response.schema.json`.

### Değişiklik izleme

Senkronlanan her tabloda `sync_txid xid8` kolonu vardır. `BEFORE INSERT OR UPDATE` trigger'ı bu kolona `pg_current_xact_id()` yazar. Silmeler ve soft delete'ler `sync_tombstones` tablosuna aynı değerle bir satır ekler. Bunlar A6 `syncable()` migration makrosunun işidir (bkz. Açık konular).

### Sorgu

Her istek için sunucu önce horizon alır:

```sql
SELECT pg_snapshot_xmin(pg_current_snapshot()) AS horizon;
```

Horizon'un altındaki tüm transaction'lar tamamlanmıştır. Bu yüzden `sync_txid < horizon` olan bir satır bir daha daha küçük bir `sync_txid` ile görünmez ve satır atlanmaz. Global kilit veya sayaç satırı yoktur; web yazmaları yavaşlamaz.

Kaynak başına satırlar ve tombstone'lar tek bir akış olarak `(sync_txid, id)` sırasıyla okunur:

```sql
-- cursor.after_id null ise:
WHERE company_id = :company AND sync_txid >= :txid AND sync_txid < :horizon
-- cursor.after_id doluysa:
WHERE company_id = :company AND (sync_txid, id) > (:txid, :after_id) AND sync_txid < :horizon
ORDER BY sync_txid, id
LIMIT :limit + 1
```

- İlk indirmede `cursor: null` gönderilir; sunucu `txid = 0` kabul eder.
- `has_more = true` ise `next_cursor`, sayfadaki son öğenin `(sync_txid, id)` değeridir. `has_more = false` ise `next_cursor = {txid: horizon, after_id: null}`.
- Bir sayfada aynı `id` en fazla bir kez geçer. Aynı kayıt hem güncellenip hem silinmişse yalnızca en son durum (`rows` ya da `tombstones`) döner.
- İstemci sayfaları sırayla uygular ve `next_cursor`'ı sayfayı yerel depoya yazdığı transaction içinde saklar.
- Satırlar policy ve şirket kapsamından geçer. Kullanıcının göremediği satır dönmez.
- `window_days` tanımlı kaynaklarda yalnızca `window_field` değeri pencere içinde olan satırlar döner. Pencereden çıkan belgeler için tombstone üretilmez; istemci yerel kopyayı aynı kurala göre kendisi budar.

### Reset

`reset: true` dönen kaynakta istemci yerel kopyayı siler ve aynı yanıttaki `rows`'u yeni tam indirmenin ilk sayfası olarak uygular. Nedenler:

| `reset_reason` | Ne zaman |
|---|---|
| `cursor_expired` | `cursor.txid` tombstone saklama süresinden (90 gün) eski. Aradaki silmeler artık bilinemez. |
| `visibility_changed` | Kullanıcının bu kaynaktaki görünürlüğü değişti (izin, rol veya kapsam değişikliği). |
| `schema_changed` | Kaynağın API Resource şekli uyumsuz değişti. |

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
  "payload": {}
}
```

- `id` istemcinin ürettiği UUIDv7'dir ve sunucuda doğrudan birincil anahtar olur. `client_id`/`server_id` ikiliği yoktur.
- `payload`, manifestteki `write.ops[].route` ucunun gövdesiyle aynıdır.
- `base_version` create için `null`, diğerleri için değişikliğin dayandığı sunucu sürümüdür.
- `changed_fields`, kullanıcının değiştirdiği üst düzey alanlardır; çakışma karşılaştırmasının girdisidir.

### İşleme

1. İstek düzeyi kontroller: token, şirket, `schema_version`, parti boyutu (`limits.push_batch_max`). Hata varsa tüm istek `error.response.schema.json` biçiminde döner.
2. Mutasyonlar **sırayla** ve her biri **kendi transaction'ında** işlenir. Parti atomik değildir.
3. `(kullanıcı, şirket, 'sync.push', idempotency_key)` daha önce tamamlanmışsa ilk sonuç `duplicate` olarak tekrar döner. Anahtar aynı ama içerik farklıysa `rejected` / `IDEMPOTENCY_KEY_REUSED`.
4. Mutasyon manifestteki `write` tanımıyla karşılaştırılır: kaynak, `op`/`action`, `payload_constraints`. Tanım dışıysa `rejected` / `SYNC_OFFLINE_WRITE_NOT_ALLOWED`. Varsayılan kural reddir; manifestte tanımlı olmayan her yazma ONLINE_ONLY'dir.
5. Mutasyon ilgili REST ucunun **FormRequest → Policy → Service** zincirinden geçirilir. Senkron için ayrı iş kuralı yazılmaz.
6. Aynı partide aynı `id` için önceki bir mutasyon `conflict` veya `rejected` olduysa sonrakiler denenmez: `rejected` / `SYNC_DEPENDENCY_FAILED`.

### Sonuçlar

| `status` | Anlamı | Zorunlu alanlar | İstemci |
|---|---|---|---|
| `applied` | Uygulandı. | `version`, `data` (`delete` için `null`); kesişimsiz birleştirmede `merged_fields` | Outbox kaydını siler, yerel satırı `data` ile değiştirir. |
| `duplicate` | Aynı anahtar daha önce uygulanmıştı. | `version`, `data` | `applied` gibi davranır. |
| `conflict` | Kullanıcı kararı gerekir. | `conflict` | Kaydı Conflict Inbox'a taşır. |
| `rejected` | Kalıcı hata. | `error` | Outbox kaydını hata koduyla işaretler, kullanıcıya gösterir. |

Geçici hatalarda (ağ, 5xx, `TOO_MANY_ATTEMPTS`, `IDEMPOTENCY_IN_PROGRESS`) sonuç yoktur; istemci partiyi aynı anahtarlarla geri çekilerek yeniden gönderir.

### Çakışma kuralları

Sessiz üzerine yazma yasaktır.

1. **Belge kilitli.** `write.draft_only` alanı (`status`) artık `draft` değilse sonuç `conflict` / `DOCUMENT_LOCKED` olur. Seçenekler: `save_as_new_draft` (istemci yeni UUIDv7 ile `create` üretir) veya `discard`.
2. **Eski sürüm, kesişim yok.** `base_version` güncel değilse, `changed_fields` ile `base_version`'dan beri sunucuda değişen alanlar (audit diff) karşılaştırılır. Kesişim yoksa değişiklik uygulanır: `applied` ve `merged_fields`.
3. **Eski sürüm, kesişim var.** Sonuç `conflict` / `VERSION_CONFLICT`; `conflicting_fields` ve `server_data` döner. Seçenekler: `keep_mine`, `take_server`, `merge`. `keep_mine` ve `merge`, `base_version = server_version` ile yeni bir `update` mutasyonu üretir.
4. **Belirsizlik çakışmadır.** Aradaki değişiklikleri audit kaydından kesin çıkaramayan alan (ör. activitylog'un izlemediği `lines`) kesişiyor sayılır.
5. **Mükerrer cari.** `parties` create'i öncesinde sunucu `GET /api/v1/parties/duplicates` ile aynı aramayı yapar. Aday varsa `conflict` / `DUPLICATE_RECORD` ve `candidates` döner. Seçenekler: `use_existing` (istemci yerel taslağı aday kayda bağlar), `keep_mine` (zorla oluşturma isteği), `discard`.

Numara verme sunucudadır. Çevrimdışı oluşturulan taslak numarasızdır; numara push uygulandığında `data.number` ile gelir.

## Okuma modları

| `read` | Davranış |
|---|---|
| `local-first` | Ekran her zaman yerel depodan okur; pull arka planda tazeler. Ana veriler ve çevrimdışı yazılabilen belgeler. |
| `online-first` | Önce ağ (kısa zaman aşımı); başarısızsa yerel kopya "eski olabilir" etiketiyle gösterilir. Son 30 günün salt okunur belgeleri. |
| `offline-fallback` | Çevrimiçiyken yalnızca ağ. Yerel anlık görüntü yalnızca çevrimdışıyken, alındığı zamanla etiketli gösterilir. Bakiyeler. |

`write` tanımlı her kaynak `local-first` olmak zorundadır (şema bunu denetler).

## Çevrimdışı yazma kapsamı

| Kaynak | İşlemler | Kısıt |
|---|---|---|
| `parties` | create | Mükerrer kontrolü (`DUPLICATE_RECORD`). |
| `sales-quotes` | create, update, delete | Yalnızca `status = draft`. |
| `sales-orders` | create, update, delete | Yalnızca `status = draft`. |
| `purchase-requests` | create, update, delete | Yalnızca `status = draft`. |
| `stock-documents` | create, update, delete, action `counts` | Yalnızca `doc_type = count` ve `status = draft`. |

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
| `SYNC_CURSOR_INVALID` | 422 | İstek. Cursor biçimsiz veya horizon'dan ileride. |
| `SYNC_RESOURCE_UNSUPPORTED` | 422 | İstek veya push `rejected`. Kaynak manifestte yok. |
| `SYNC_OFFLINE_WRITE_NOT_ALLOWED` | 422 | Push `rejected`. Mutasyon `write` tanımının dışında. |
| `SYNC_BATCH_TOO_LARGE` | 413 | İstek. Kaynak veya mutasyon sayısı limitin üstünde. |
| `SYNC_DEPENDENCY_FAILED` | — | Yalnızca push `rejected`. Aynı kaydın önceki mutasyonu başarısız. |

Push sonuçlarında mevcut kodlar da kullanılır: `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE_TRANSITION`, `APPROVAL_REQUIRED`, `IDEMPOTENCY_KEY_REUSED`. İzin kaybı `FORBIDDEN`, iptal edilmiş cihaz `UNAUTHENTICATED` döner.

## Cihaz kimliği

- `POST /api/v1/auth/device`: e-posta, parola, TOTP (2FA açıksa), `device_name`, `fingerprint`. `desktop` yetenekli Sanctum token'ı verir; token cihaza (`user_devices`) bağlıdır.
- `GET /api/v1/me/devices` ve `DELETE /api/v1/me/devices/{id}`: cihazları listeler ve iptal eder.
- Pasifleştirme, parola değişimi ve yönetici sıfırlaması cihaz token'larını iptal eder (`AccessRevoker`).
- Hedef: kısa ömürlü erişim token'ı ve döndürülerek yenilenen refresh token (ADR 0007). Bugünkü durum Açık konular'dadır.

## Saklama ve limitler

| Değer | Süre / sınır |
|---|---|
| Tombstone | 90 gün. Daha eski cursor `reset: cursor_expired` alır. |
| Push idempotency kaydı | 7 gün (`sync.push` kapsamı). |
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
- `fixtures/*.json` şemasına karşı geçmeli, `fixtures/invalid/*.json` kalmalıdır.
- Sunucu testleri (Pest) pull/push yanıtlarını bu şemalara karşı doğrular; Rust testleri aynı fixture'ları deserialize eder.
- Manifestteki her route, backend route tanımlarında bulunmalıdır. Bu kontrol CI'da `php artisan route:list --json` çıktısına karşı yapılmalıdır.

## Açık konular

Web'de hazırlanması planlanan A6 zemininin ve senkron sunucusunun backend'de henüz olmayan parçaları. Kontrol `backend/` kaynak kodu üzerinde yapıldı.

**Senkron altyapısı (A6)**

1. `syncable()` migration makrosu yok. Hiçbir tabloda `sync_txid` kolonu, index'i veya `pg_current_xact_id()` trigger'ı yok.
2. `sync_tombstones` tablosu ve silme/soft delete trigger'ı yok. Manifestteki kaynakların çoğu `SoftDeletes` kullanıyor (`Party`, `Item`, `Unit`, `PriceList`, `ItemCategory`, `ItemVariant`, `DiscountRule`, Reference modelleri); trigger `deleted_at` dolduğunda da tombstone yazmalı, geri alınınca satırı yeniden yaymalı.
3. `backend/app/Core/Sync/` dizini boş; `Modules/Sync` modülü ve `GET /sync/manifest`, `POST /sync/pull`, `POST /sync/push` uçları yok.
4. Gömülü ilişkiler (`parties` → `addresses`/`contacts`/`bank_accounts`, belgeler → `lines`, `items` → `units`) yalnızca üst satırın `sync_txid`'i değişirse yayılır. Alt satır yazmalarının üst satırı güncellediği doğrulanmalı (özellikle `parties/{party}/addresses` gibi ayrı alt uçlar). Değilse alt tablo trigger'ı üst satırı dokunmalı.
5. Görünürlük değişimini (`visibility_changed`) tespit edecek mekanizma yok: rol/izin değişiminde kullanıcı-şirket için kaynak bazında reset işareti tutulmalı.

**Push zinciri**

6. Store FormRequest'leri istemcinin gönderdiği `id`'yi kabul etmiyor. `HasUuid7` modelde istemci kimliğine izin veriyor, ama `parties`, `sales-quotes`, `sales-orders`, `purchase-requests` ve `stock-documents` için doğrulama kuralı (UUIDv7, benzersiz) eklenmeli.
7. `Idempotency-Key` saklama süresi 24 saat (`config/idempotency.php`, `IDEMPOTENCY_TTL_HOURS`). Push için 7 gün gerekli; `sync.push` kapsamına ayrı TTL verilmeli.
8. Taslak olmayan belgeyi düzenleme bugün `INVALID_STATE_TRANSITION` (422, `document_not_editable`) döndürüyor. Push bunu `DOCUMENT_LOCKED`'a çevirmeli; önerilen 8 kod `ErrorCode`'a eklenmeli.
9. `POST /api/v1/parties` mükerrer kontrolü yapmıyor; `DuplicateFinder` yalnızca `GET /api/v1/parties/duplicates` ucunda. Push create'i öncesinde çağrılmalı.
10. Alan bazlı birleştirme için audit diff yetersiz: activitylog `Party` için `version`'ı, `SalesDocument` için satırları kaydetmiyor. Kural 4 (belirsizlik çakışmadır) bu yüzden şart; daha iyi birleştirme için sürüm bazlı alan değişikliği kaydı gerekiyor.
11. Sunucu toplamları hesaplıyor (`preview-totals`). Çevrimdışı taslakta tutarlar geçicidir; push sonrası `data` ile kesinleşir.

**Cihaz kimliği**

12. `POST /auth/device`, `GET /me/devices` ve `DELETE /me/devices/{id}` var. Refresh token ve kısa ömürlü erişim token'ı yok: token tek ve 30 günlük (`DeviceTokens`: `sanctum.device_token_ttl_days` / `identity.device_tokens.ttl_days`). Yenileme ucu ve döndürme ADR 0007'ye göre eklenmeli.

**Kapsam**

13. B3'teki çevrimdışı yazma türlerinden masraf beyanı, izin talebi, puantaj/zaman çizelgesi (İK, Faz 11) ile not ve aktivite için backend'de modül veya uç yok; manifestte yer almıyorlar.
14. ONLINE_ONLY listesindeki bordro ve MRP çalıştırma uçları yok (Faz 10 ve 11); eklenince manifeste girecek.
15. Cari bakiyesi için ayrı liste ucu yok. Anlık görüntü `treasury-reports/receivables-ageing` ve `payables-ageing` raporlarından alınıyor; `customers/{id}/exposure` cari başına ve çevrimiçi.
16. Depolar iki uçtan okunuyor: `warehouses` (Reference, ana veri) ve `stock-warehouses` (Inventory ayarları). Manifest ana veri olarak `warehouses`'ı kullanıyor.

**Frontend zemini (A6)**

17. `frontend/src/platform/` altında `http`, `connectivity`, `notify`, `realtime` var; `files` (kaydet/yazdır/aç) arayüzü yok.
18. Query key'ler `[resource, …]` standardında değil, modül köklü: `['parties', company]`, `['catalog', company, 'items', …]`, `['inventory', company, 'docs', …]`, `['reference', name, …]`. Senkron sonrası jenerik invalidation için ya key'ler standartlaştırılmalı ya da manifest kaynağı → key öneki eşlemesi tutulmalı.
19. Manifest route'larını `php artisan route:list --json` ile karşılaştıran ve fixture'ları şemalara karşı doğrulayan CI adımı yok.
