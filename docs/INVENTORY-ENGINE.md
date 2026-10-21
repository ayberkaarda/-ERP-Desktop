# Stok Motoru: Hareket Defteri, Değerleme ve Raporlar

Bu belge `backend/app/Modules/Inventory` modülünün gerçekte nasıl çalıştığını anlatır: tek doğruluk
kaynağı olan stok hareket defteri, bakiyeler, değerleme ve FIFO katmanları, belgeler ve yaşam
döngüleri, sayım, lot/seri/FEFO, rezervasyonlar, muhasebe entegrasyonu, komutlar, API ve raporlar.
Davranışların tamamı `backend/tests/Feature/Inventory/*` altındaki testlerle sınanır.

## 1. Mimari

### 1.1 Tablolar

| Tablo | Görevi |
|---|---|
| `stock_movements` | **Yalnızca eklenen (append-only)** stok defteri; her şeyin kaynağı. Satır başına kalem, depo, lokasyon, lot, seri, hareket türü (`receipt`, `issue`, `transfer_out`, `transfer_in`, `count_adjustment`, `opening`, `return_in`, `return_out`, `production_in`, `production_out`, `scrap`), yön (`in`/`out`), pozitif miktar (20,6), birim maliyet (20,6), toplam maliyet (20,4), tarih (`occurred_at`), belge bağlantısı, `journal_entry_id`, `reverses_id`, `cost_layer_id`, `seq` (küresel kimlik sütunu; sıralama anahtarı). |
| `stock_valuations` | (şirket, kalem, depo) çifti başına miktar, değer ve hareketli ortalama. Çiftin **kilidi** (mutex) bu satırdır. |
| `stock_balances` | (şirket, kalem, depo, lokasyon, lot) başına eldeki (`on_hand`), ayrılmış (`reserved`), üretilmiş `available = on_hand - reserved`, ortalama ve değer payı. Lokasyon/lot yoksa nil UUID (`00000000-...`) kullanılır; böylece birincil anahtar düz kalır. |
| `stock_cost_layers` | FIFO katmanları: ilk miktar, kalan miktar, kalan değer, birim maliyet, giriş tarihi. Yalnızca şirket FIFO kullanıyorsa yazılır. |
| `stock_documents`, `stock_document_lines` | Stok belgeleri (taslak → kayıtlı → iptal) ve satırları. |
| `stock_lots`, `stock_serials` | Lotlar (son kullanma/üretim tarihi) ve seri birimleri (durum: `in_stock`, `reserved`, `issued`, `scrapped`). |
| `stock_reservations` | Rezervasyonlar (`active`, `released`, `consumed`, `expired`). |
| `stock_warehouse_settings` | Depo başına rezervasyon politikası (`none` / `soft` / `hard`). |

Para alanları numeric(20,4), miktar ve birim maliyetler numeric(20,6); tüm hesaplar brick/math ile
yarıya-çift (half-even) yuvarlama kullanır. Modüller arası kimlikler yabancı anahtarsız düz uuid
sütunlarıdır.

### 1.2 Depolar Reference modülündedir

Depo ve lokasyon ana verisi Inventory'de değil **Reference** modülündedir (`warehouses`,
`locations` tabloları; API: `/warehouses`, `/warehouses/{id}/locations`). Inventory bu tabloları
yalnızca sütun adıyla okur (`WarehouseDirectory`, `WarehouseLookup` sözleşmesi) ve depo başına
kendi ayarını `stock_warehouse_settings` tablosunda tutar. Negatif stok, Reference deposunun
`negative_stock_policy` alanıdır: `block` (varsayılan) negatife izin vermez; `allow` ve `warn`
izin verir. `/stock-warehouses` uçları depoları stok politikasıyla birlikte listeler ve yalnızca
`reservation_policy` alanını günceller. Hareketi olan bir deponun silinmemesi için Reference,
`WarehouseLookup::hasMovements()` ile sorgu yapmalıdır.

### 1.3 Defter kuralları ve kilit sırası

- Hareketler değiştirilemez: `UPDATE`, `DELETE` ve `TRUNCATE` tetikleyiciyle reddedilir (`KI001`).
  Düzeltme yalnızca ters hareketle yapılır.
- Bir kayıt (posting) tek veritabanı işlemidir. Sıra: belge satırı `FOR UPDATE` ile kilitlenir →
  dönem kontrolü (`PeriodGuard::assertOpen`) → dokunulan (kalem, depo) çiftlerinin
  `stock_valuations` satırları **(kalem, depo) sırasıyla** eklenip kilitlenir → FIFO'da katmanlar
  → çiftlerin `stock_balances` satırları anahtar sırasıyla kilitlenir → tahsis, maliyetleme,
  stok ve rezervasyon kontrolleri → belge numarası → yevmiye fişi → hareketlerin yazılması →
  bakiyeler, katmanlar, seriler → ertelenmiş negatif stok kontrolü işlem içinde tetiklenir →
  olaylar commit sonrası yayılır.
- Aynı çiftlere dokunan iki kayıt aynı sırayla kilitlediği için kilitlenme (deadlock) yerine sıraya
  girer; rezervasyonlar ve `inventory:rebuild-balances` da aynı sırayı izler (yeniden kurma önce
  `stock_valuations` tablosunu kilitler).
- Veritabanı değişmezleri (migration'larla kurulur, ham SQL ile ihlal denenerek test edilir):
  1. hareketler değişmez (`KI001`);
  2. negatif stoka izin vermeyen depoda `on_hand` negatif olamaz (ertelenmiş kısıt tetikleyicisi,
     `KI002`);
  3. seri durum geçişleri geçerli olmalıdır (`KI003`): giriş yalnızca `in_stock`; `in_stock →
     issued|reserved|scrapped`, `reserved → in_stock|issued`, `issued|scrapped → in_stock`;
  4. hareketin lotu/serisi aynı kaleme aittir, ters hareket tersine çevirdiği hareketin aynasıdır
     (`KI004`); bir hareket en fazla bir kez ters çevrilebilir (kısmi benzersiz indeks);
  5. kayıtlı veya iptal belge ve satırları değiştirilemez (`KI005`);
  6. her bakiye anahtarında `on_hand = SUM(in) - SUM(out)`; değişmez testleri ve yeniden kurma
     komutu bunu denetler.
- Tetikleyici ihlalleri `StockViolation` ile 422'ye çevrilir.

## 2. Değerleme

Şirket ayarı `inventory.valuation_method`: `moving_average` (varsayılan) veya `fifo`. Hareket
oluştuktan sonra değiştirilemez (422). `inventory.cost_rounding_scale` (2..6, varsayılan 6) birim
maliyet ve ortalamanın ölçeğidir; tutarlar her zaman 4 ondalıktır.

**Hareketli ağırlıklı ortalama** (`Valuator`):

- Giriş: `ortalama = (değer + giriş değeri) / (miktar + giriş miktarı)`.
- Çıkış mevcut ortalamayla maliyetlenir (`miktar × ortalama`, 4 ondalık). Stoku sıfırlayan çıkış
  kalan değerin tamamını alır; böylece sıfır miktarda değer kalıntısı kalmaz (ör. 3 adet
  3,333333'ten: 3,3333 + 3,3333 + 3,3334).
- Örnek: 10 × 10 ve 5 × 16 → ortalama 12; 6 çıkış = 72; 3 × 20 giriş → (108 + 60) / 12 = 14.

**FIFO**: her giriş bir katman açar; çıkış en eski katmandan başlayarak tüketir ve **tüketilen her
katman için ayrı hareket** yazar (`cost_layer_id` dolu). Tamamen tüketilen katman kalan değerini
verir. Örnek: 10 × 10, 5 × 16 girişlerinden 12 çıkış = 10 × 10 + 2 × 16 = 132.

Diğer kurallar:

- Transfer kaynak maliyetle taşınır: çıkış kaynakta maliyetlenir, giriş hedefte aynı tutarla
  yapılır (FIFO'da hedef katman orijinal giriş tarihini korur).
- Sayım fazlası ve maliyetsiz girişler mevcut ortalamayla, açılış ve alış girişleri verilen
  maliyetle değerlenir (açılışta birim maliyet zorunludur).
- Negatif stok (yalnızca izin veren depoda): karşılanmayan kısım son bilinen ortalamayla
  maliyetlenir; sonraki girişte **otomatik düzeltme yapılmaz**.
- Çift değeri bakiye satırlarına `on_hand × ortalama` olarak dağıtılır; yuvarlama farkı en çok
  stoğu olan satıra yazılır (`BalanceValues`). Bakiye satırları toplamı her zaman çift değerine,
  çift değeri de hareketlerin işaretli `total_cost` toplamına eşittir.

## 3. Belgeler ve yaşam döngüsü

Belge türleri ve numara serileri: `receipt` (REC), `issue` (ISS), `transfer` (TRF), `count` (CNT),
`adjustment` (ADJ), `opening` (OPN). Numaralar şirket, tür ve mali yıl başına boşluksuz olarak
`NumberSequenceService` ile **yalnızca kayıt anında** verilir (ör. `REC2027000000001`).

Durumlar: `draft` → `posted` → `cancelled`.

- **Taslak**: `POST /stock-documents` (Idempotency-Key zorunlu, en çok 500 satır) ve
  `PATCH /stock-documents/{id}` (`version` ile iyimser kilit). Miktarlar kaydedilirken kalemin
  temel birimine çevrilir (`base_quantity`). Yalnızca taslak silinebilir.
- **Kayıt**: `POST /stock-documents/{id}/post` yukarıdaki tek işlemi çalıştırır.
  Satır türüne göre hareket: `receipt`/`opening` giriş; `issue` çıkış (karşı olay
  `inventory.scrap` ise hareket türü `scrap`); `adjustment` satırın `direction` alanına göre
  `count_adjustment` girişi veya çıkışı; `transfer` kaynakta `transfer_out`, hedefte
  `transfer_in` (aynı depoda yalnızca farklı hedef lokasyonla); `count` farklar.
- **Ters kayıt**: `POST /stock-documents/{id}/reverse {date, reason}`. Her orijinal hareketin
  aynası (ters yön, aynı miktar ve maliyet, `reverses_id` dolu) yazılır, yevmiye fişi
  `PostingService::reverse` ile ters çevrilir ve belge **`cancelled`** olur. Tarih belge
  tarihinden önce olamaz; negatif stoka izin vermeyen depoda stoku eksiye düşürecekse, FIFO
  katmanı tüketilmişse veya seri birim o günden beri hareket etmişse reddedilir.
- **Sözleşme ile kayıt**: diğer modüller (satış, satın alma, üretim) `StockService::post()`
  çağırır; istek bir belge olarak saklanıp hemen kaydedilir. `(şirket, source_type, source_id,
  purpose)` başına idempotenttir (danışma kilidi + kısmi benzersiz indeks); ikinci çağrı mevcut
  sonucu döner.
- Satır CSV içe aktarma (`POST /stock-documents/{id}/import`, kuru çalıştırma destekli): sayım
  için `item_code, counted_quantity, location_code?, lot_no?`; açılış için `item_code, quantity,
  unit_cost, lot_no?, expiry_date?, serial_numbers? (| ile), location_code?`. Herhangi bir satır
  hatası uygulamayı engeller.

## 4. Sayım

Sayım `count` türünde bir belgedir. Oluşturulurken (varsayılan `freeze: true`, `item_ids` ile
daraltılabilir) deponun sıfır olmayan bakiyeleri sistem miktarı (`system_quantity`) dondurulmuş,
sayılmamış satırlar olarak eklenir. Sayılan miktarlar `PATCH /stock-documents/{id}/counts` ile
(veya CSV ile) girilir; anlık görüntüde olmayan stok yeni satırla eklenir (sistem miktarı eklendiği
andaki eldeki miktardır). Kayıtta her bakiye anahtarı bir kez işlenir; fark pozitifse ortalama
maliyetle `count_adjustment` girişi (karşı olay `inventory.adjustment_gain`), negatifse çıkış
(`inventory.adjustment_loss`) yazılır ve fark fişi kesilir. Sayılmamış satırlar (counted null) ve
seri izlemeli kalemler sayımda işlenmez (seri kalem 422).

## 5. Lot, seri ve FEFO

- Lot izlemeli (`tracking = lot`) veya son kullanmalı (`has_expiry`) kalemde girişte `lot_no`
  zorunludur; son kullanmalı kalemde `expiry_date` de zorunludur ve bir lotun son kullanma tarihi
  sonradan değiştirilemez.
- Seri izlemeli kalemde miktar seri numarası sayısına eşit bir tamsayı olmalıdır; her seri birim
  ayrı hareket (miktar 1) olarak yazılır.
- Çıkışta lot verilmezse **FEFO** uygulanır: lotlar son kullanma tarihine (sonra lot numarası,
  lokasyonsuz satır önce) göre sıralanır. Süresi geçmiş lotlar atlanır; yeterli stok kalmazsa
  "süresi geçmemiş stok yetersiz" hatası döner. Süresi geçmiş lottan çıkış yalnızca belgede
  `allow_expired` işaretli ve kaydeden kullanıcı `inventory.documents.issue_expired` iznine
  sahipse yapılır (aksi halde 403). İzlenebilirlik: `GET /stock-lots/{id}/trace`.

## 6. Rezervasyonlar

`Reservations::reserve/release/consume` ve `/stock-reservations` uçları rezervasyonu tutar ve
`stock_balances.reserved` alanını **aynı çift kilidi altında** günceller; böylece son birimler için
rezervasyon ile çıkış (veya iki rezervasyon) sıraya girer. Politika depo başınadır:

- `none`: rezervasyon yapılamaz;
- `soft` (varsayılan): kullanılabilir miktarı aşan rezervasyona izin verir, aşımı `meta.shortage`
  ile bildirir;
- `hard`: kullanılabilir miktarı aşan rezervasyonu reddeder; çıkışlar başkası için ayrılmış stoğu
  alamaz, FEFO lot rezervasyonlarının tuttuğu stoğu atlar.

Çıkış satırı `reservation_id` verirse rezervasyonun çıkış kadar kısmı tüketilir (kalan ayrılmış
kalır; tamamı kullanılırsa `consumed`), lotlu rezervasyon satırı o lota bağlar.
`expires_at` geçmiş rezervasyonlar `inventory:expire-reservations` ile `expired` olur.

## 7. Muhasebe entegrasyonu

Mali etkisi olan her belge Accounting `PostingService` üzerinden `source_type = stock_document`
ile tek fiş üretir (`EntryType::System`); fiş kimliği belgeye ve hareketlere yazılır. Satırlar hesap
ve yön bazında toplanır. Hesaplar `AccountDeterminer` ile olay anahtarından çözülür (bağlam:
`item_id`, `item_category`, `warehouse_id`; depo bazında kural tanımlamak bu yüzden mümkündür):

| Olay | Varsayılan TDHP | Kullanım |
|---|---|---|
| `inventory.stock` | 153 Ticari Mallar | stok hesabı (Accounting tohumlar) |
| `inventory.cogs` | 621 Satılan Ticari Mallar Maliyeti | çıkışların varsayılan karşılığı (Accounting tohumlar) |
| `inventory.adjustment_gain` | 397 Sayım ve Tesellüm Fazlaları | sayım/düzeltme fazlası; karşı olay verilmemiş alış girişinin varsayılanı |
| `inventory.adjustment_loss` | 197 Sayım ve Tesellüm Noksanları | sayım/düzeltme noksanı |
| `inventory.scrap` | 689 Diğer Olağandışı Gider ve Zararlar | hurda çıkışı |
| `inventory.opening_offset` | 500 Sermaye | açılış stoku (açılış fişi zaten taşıyorsa kural değiştirilmeli) |

- Giriş: Borç stok / Alacak karşı hesap; çıkış: Borç karşı hesap / Alacak stok.
- Transferin mali etkisi yoktur (fiş kesilmez). Belge `offset_event` ile karşı olayı seçebilir
  (`inventory.adjustment_gain`, `inventory.adjustment_loss`, `inventory.scrap`,
  `inventory.opening_offset`, `inventory.cogs`).
- Son dört olayın kuralları şirket oluşturulurken (`CompanyCreated` dinleyicisi, Accounting
  hesap planından sonra) sistem kuralı olarak eklenir; mevcut şirketler için
  `inventory:seed-rules`. Ekleme idempotenttir; hesap yoksa veya kayıt yapılamazsa atlanır.
- Değişmez: `stock_valuations.value` toplamı stok hesabının (153) bakiyesine eşittir; testler
  her iki değerleme yöntemi için ve geçmiş tarihlerde doğrular.

## 8. Komutlar

| Komut | Görevi |
|---|---|
| `inventory:rebuild-balances {company?} {--check}` | `stock_valuations` ve `stock_balances` tablolarını hareketlerden (ve aktif rezervasyonlardan) yeniden kurar; `--check` yalnızca farkları raporlar. |
| `inventory:seed-rules {company?}` | Varsayılan stok belirleme kurallarını ekler (idempotent). |
| `inventory:expire-reservations {company?}` | Süresi dolan aktif rezervasyonları `expired` yapar; her dakika zamanlanır. |
| `inventory:check-reorder {company?}` | Yeniden sipariş noktasındaki/altındaki kalemler için `StockBelowReorderPoint` olayı ve `inventory.stock.view` iznine sahip kullanıcılara bildirim; her gün 07:00 (Europe/Istanbul). |

Şirket verilmezse tüm aktif şirketler işlenir.

## 9. API özeti (`/api/v1`)

| Uç | İzin |
|---|---|
| `GET /stock-warehouses`, `GET/PATCH /stock-warehouses/{id}` (rezervasyon politikası) | `inventory.warehouses.view` / `manage` (liste stok ve belge görüntüleyenlere de açık) |
| `GET/POST /stock-documents`, `GET/PATCH/DELETE /stock-documents/{id}`, `PATCH .../{id}/counts`, `POST .../{id}/import`, `POST .../{id}/post`, `POST .../{id}/reverse`, `GET /stock-documents/export` | `inventory.documents.view` / `create` / `post` / `reverse` |
| `GET /stock-balances` (`group_by=warehouse|item|detail`), `/stock-balances/export`, `GET /items/{id}/stock` | `inventory.stock.view` |
| `GET /stock-movements` (imleç sayfalama), `/stock-movements/export` | `inventory.stock.view` |
| `GET /stock-lots`, `/stock-lots/{id}`, `/stock-lots/{id}/trace`, `/stock-serials`, `/stock-serials/{id}` | `inventory.stock.view` |
| `GET/POST /stock-reservations`, `GET /stock-reservations/{id}`, `POST .../{id}/release` | `inventory.reservations.manage` (liste stok görüntüleyenlere de açık) |
| `GET /reports/reorder-suggestions` | `inventory.stock.view` |
| `GET /inventory-reports/*` (bölüm 10) | `inventory.reports.view` |

Oluşturan POST'lar `Idempotency-Key` ister. Varsayılan roller: Warehouse (belgeler, rezervasyon,
raporlar), Accountant (görüntüleme, ters kayıt, raporlar), Sales/Purchasing (stok görüntüleme),
Viewer (görüntüleme, raporlar). Sözleşmeler (`App\Modules\Inventory\Contracts`): `StockService`,
`StockAvailability`, `Reservations`, `WarehouseLookup`; olaylar `StockPosted`, `StockReversed`,
`StockBelowReorderPoint` (commit sonrası).

## 10. Raporlar

Tüm uçlar `GET /api/v1/inventory-reports/...` altındadır, `inventory.reports.view` izni ister
(varsayılan roller: Warehouse, Accountant, Viewer) ve yalnızca etkin şirketin verisini okur. İzin
doğrulamadan önce denetlenir (izinsiz çağrı her zaman 403); hatalı parametre 422 döner. Sayılar
metindir: miktar 6, tutar 4, ortalama maliyet 6 ondalık (`"12.000000"`, `"168.0000"`).

**Kaynak:** Raporlar bakiye tablolarını değil `stock_movements` defterini okur ve tarih itibarıyla
(`occurred_at <= as_of`) yeniden kurar; testler `as_of = bugün` için sonuçların
`stock_valuations`/`stock_balances` ile, değerleme toplamının da aynı tarihteki 153 bakiyesiyle
eşit olduğunu doğrular. İstisna: son kullanma raporu güncel lot bakiyelerini okur. FIFO şirkette
yaşlandırma katmanları da `as_of` tarihine göre hareketlerden yeniden kurar. Her rapor tek bir `REPEATABLE READ, READ ONLY` işlemde
okunur; kalem/depo/kategori adları tür başına tek toplu sorguyla gelir (N+1 yok).

**Ortak parametreler:** `warehouse_id`, `category_id` (alt kategoriler dahil), `item_id`, `q`
(kalem kodu/adı), `page`, `per_page` (en çok 500). Yanıt: `data` (sayfanın satırları), `meta`
(tarih/aralık, temel, toplamlar ve `pagination`). Aralık raporlarında `date_to` varsayılanı bugün,
`date_from` varsayılanı `date_to` yılının 1 Ocak'ıdır.

| Uç | İçerik | Parametreler |
|---|---|---|
| `stock-status` | Tarih itibarıyla miktar, ortalama maliyet ve değer. Depo/kategori satırlarında miktar ve ortalama `null`, `item_count` ve `value` dolu. `meta.totals.value`. | `as_of`, `group_by=item_warehouse|item|warehouse|category`, `include_zero` |
| `stock-ledger` (stok kartı / kartex) | Bir kalemin `date_from` öncesi açılışı (`meta.opening`), aralıktaki hareketleri tarih ve kayıt sırasıyla: giriş/çıkış miktarı ve tutarı, birim maliyet, belge numarası, lot/seri ve her satırdan sonraki yürüyen miktar, değer ve ortalama (sayfalar arasında süren pencere toplamı). `meta.totals`, `meta.closing`, `meta.item`. Başka şirketin kalemi 404. | `item_id` (zorunlu), `warehouse_id`, `date_from`, `date_to` |
| `valuation` | Tarih itibarıyla değerleme. Şirket yöntemiyle (varsayılan) **kayıtlı** değerler (`basis: booked`, stok hesabıyla mutabık). Diğer yöntem istenirse hareketler kayıt sırasıyla aynı `Valuator` ile yeniden oynatılır (`basis: simulated`): girişler kayıtlı maliyetini korur, çıkışlar yeniden maliyetlenir; FIFO katmanları defterin kendi sırasıyla (giriş tarihi, sonra oluşma sırası; geriye tarihli giriş önce) tüketilir ve biten katmanlar atılarak yeniden oynatma hareket sayısıyla doğrusal kalır; bu bir "ya olsaydı" rakamıdır ve muhasebeyle mutabık değildir. `meta.method`, `meta.company_method`. | `as_of`, `method=moving_average|fifo`, `group_by`, `include_zero` |
| `ageing` | Eldeki miktar ve değerin giriş tarihine göre 0-30, 31-60, 61-90, 90+ gün kovaları (`qty_0_30`, `value_0_30`, ... `qty_over_90`, `value_over_90`). `basis: layers` (FIFO şirket, her `as_of` için): katmanlar `as_of` tarihindeki haliyle hareketlerden yeniden kurulur — katmanı açan hareket tarihliyse katman vardır; kalan miktar ve değer, açılış tutarından `cost_layer_id` ile ondan tüketilen kısımlar düşülüp ters kayıtla geri verilenler eklenerek bulunur; açan hareketi ters çevrilmiş katman yoktur. Katman giriş tarihini korur (transfer kaynak katmanın tarihini taşır), bu yüzden transfer ve ters kayıt stoku gençleştirmez; `as_of` sonrası tarihli giriş ve tüketimler sayılmaz. `basis: receipts` (hareketli ortalama): eldeki miktar en yeni girişlerle eşleştirilir (kalan stok en son gelen stoktur; `as_of`'a kadar ters çevrilmiş girişler sayılmaz); değer FIFO'da girişin maliyeti, ortalamada çiftin ortalamasıdır, yuvarlama farkı en yeni parçaya yazılır. Girişle açıklanamayan miktar en eski kovaya düşer. | `as_of`, `group_by=item_warehouse|item` |
| `expiring-lots` | Bugün stokta olan ve `days` gün içinde süresi dolan lotlar (lot × depo, lokasyonlar toplanır), en yakın tarih önce; süresi geçenler `expired: true` ve negatif `days_to_expiry` ile. `meta.totals` (lot sayısı, süresi geçen, değer). | `days` (0..3650, varsayılan 30), `include_expired` (varsayılan true) |
| `abc-analysis` | Kalem bazında ABC. `basis=consumption` (varsayılan): aralıkta net tüketim değeri (çıkış ve üretim kullanımı, ters kayıtları düşülerek); `basis=stock_value`: `date_to` itibarıyla stok değeri. Değere göre azalan sıralama, `share` ve `cumulative_share` (yüzde, 4 ondalık). Sınıf: önceki kümülatif pay `a`'dan küçükse A, `b`'den küçükse B, değilse C (sınırı aşan kalem üst sınıfta kalır; ilk kalem her zaman A). Karşılaştırma yuvarlanmamış değerlerle yapılır (`kümülatif × 100 < toplam × sınır`); yüzdeler yalnızca çıktıda yuvarlanır. `meta.totals.classes`. | `date_from`, `date_to`, `basis`, `a` (varsayılan 80), `b` (varsayılan 95) |
| `turnover` | Açılış (`date_from` öncesi) ve kapanış (`date_to`) değeri, ortalama stok `(açılış + kapanış) / 2` (5 ondalıkta tam, yuvarlanmaz; böylece satır ortalamaları toplama eşittir), tüketim değeri, devir hızı `tüketim / ortalama` (4 ondalık; ortalama sıfırsa `null`), stokta kalma günü `ortalama × gün / tüketim` (2 ondalık; tüketim yoksa `null`). Oranlar tam ortalamadan hesaplanır ve yalnızca sonuç yuvarlanır; toplamlar aynı formülleri toplanmış tam değerlere uygular. `meta.days`, `meta.totals`. | `date_from`, `date_to`, `group_by=item|item_warehouse|warehouse|category` |
| `movement-summary` | Grup başına açılış, giriş, çıkış ve kapanış (miktar ve değer; ters kayıtlar hareket ettikleri yönde sayılır), kapanış = açılış + giriş − çıkış. `meta.by_type`: hareket türü ve yön başına adet ve değer. | `date_from`, `date_to`, `group_by`, `include_zero` |

Tüketim, `issue` ve `production_out` hareketleridir (hurda, iade ve sayım farkları tüketim
sayılmaz). `GET /reports/reorder-suggestions` (yeniden sipariş önerileri) ayrı bir uç olarak
`inventory.stock.view` izniyle çalışmaya devam eder.

**Dışa aktarma:** Her raporun `/export?format=csv|xlsx` ucu vardır (varsayılan CSV, UTF-8 BOM),
aynı parametreleri alır ve sayfalama olmadan tüm satırları yazar. Satır sınırı
`inventory.export_max_rows` (50.000); aşılırsa 422. Sayılar tam ondalık metin olarak yazılır;
XLSX hücreleri metin tipindedir (kayan noktaya çevrilmez). `=`, `+`, `-`, `@`, sekme veya satır
sonuyla başlayan metin hücrelerinin başına `'` eklenir; yalnızca sayı olan değerler olduğu gibi
kalır. Stok kartı dosyasında başta açılış, sonda kapanış (aralık toplamlarıyla) satırı bulunur.

**Performans:** Raporlar birkaç bin hareket üzerinde sabit sayıda sorguyla çalışır (testte her
rapor 40 sorgunun altında); yürüyen bakiyeler ve yaşlandırma eşleştirmesi veritabanında pencere
fonksiyonlarıyla hesaplanır. FIFO simülasyonu 20.000 açık katmanda da doğrusal çalışır (testte). Ek indeks gerekmedi: `(company_id, item_id, warehouse_id)` ve
`(company_id, occurred_at)` indeksleri yeterlidir.
