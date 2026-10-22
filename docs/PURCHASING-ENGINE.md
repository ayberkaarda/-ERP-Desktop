# Satınalma motoru

Bu belge satınalma belgelerinin yaşam döngüsünü, tedarikçi borcu, stok ve muhasebe bağlantılarını ve API sözleşmesini açıklar. Uygulama `backend/app/Modules/Purchasing` altındadır; belge ve satırlar şirket kapsamındadır, kimlikler UUIDv7 kullanır. Tutarlar veritabanında `numeric(20,4)`, miktarlar `numeric(20,6)`, kur `numeric(20,6)` saklanır. Birim fiyat hassasiyeti satırlarda `numeric(20,6)`'dır. Döviz tutarları kurla şirket para birimine çevrilir; hesaplama `BigDecimal` ile yapılır.

## Belge zinciri ve durumlar

| Belge | Durumlar | Temel geçiş |
|---|---|---|
| Satınalma talebi | `draft`, `pending_approval`, `approved`, `rejected`, `partially_ordered`, `ordered`, `cancelled` | Gönder, Workflow onayı/ret, RFQ veya siparişe dönüştür, iptal et. Siparişe dönüşen miktar ilerleme kayıtlarından hesaplanır. |
| Teklif çağrısı (RFQ) | `draft`, `sent`, `collecting`, `awarded`, `cancelled` | Tedarikçilere gönder, teklifleri kaydet ve karşılaştır, seçilen teklifi ödüllendirerek sipariş oluştur. |
| Sipariş | `draft`, `pending_approval`, `approved`, `sent`, `partially_received`, `received`, `partially_invoiced`, `invoiced`, `closed`, `cancelled` | Gönderim onayı, tedarikçiye gönderme, mal kabul/faturalama ilerlemesi, kapatma veya iptal. |
| Mal kabul | `draft`, `posted`, `cancelled` | Kaydetme Inventory stok girişini ve maliyetini oluşturur; iptal ters stok belgesiyle yapılır. |
| Tedarikçi faturası | `draft`, `pending_approval`, `booked`, `partially_paid`, `paid`, `cancelled`, `reversed` | Onay gerekirse beklet, deftere işle, ödeme uygulamalarını yansıt, ters kayıt yap. |
| Satınalma iadesi | `draft`, `approved`, `shipped`, `debited`, `cancelled` | Onayla, malı gönder, tedarikçi borç dekontunu oluştur. |
| Borç dekontu | Faturanın `return` türü; kendi fatura durumu ve numarası | İade `debit` edildiğinde ters yönlü yevmiye üreten ayrı satınalma faturası kaydedilir. |

Taslaklar sürüm (`version`) denetimiyle düzenlenir; aynı sürümün dışındaki güncelleme çakışması reddedilir. Kaynak belgeye bağlı yeni belge, kaynak satırın ürün, birim, fiyat ve miktar sınırlarını kullanır. Sipariş, mal kabul veya fatura bağlantısı aldıktan sonra revize edilemez. İlerleme miktarları istemciden alınmaz; sipariş satırlarının alınan ve faturalanan miktarları ilişkili belgelerden hesaplanır.

Talep ve RFQ numaraları ihtiyaç aşamasında atanır; sipariş numarası onaylandığında, mal kabul numarası post işleminde, fatura/borç dekontu numarası deftere kayıtta, iade numarası onayda verilir. Bir işlem başarısız olursa belge numarası ve muhasebe/stok yan etkileri işlem bütünlüğü içinde geri alınır.

## Tutar, vergi ve fiyat

Tutar motoru kayan nokta kullanmaz. Satır brütü miktar × birim fiyat üzerinden hesaplanır; iskonto yüzdesi ve tutarı düşülerek net tutar, vergi ve varsa tevkifat hesaplanır. Satır toplamı net + vergidir; başlık toplamı `subtotal - discount_total + tax_total` eşitliğini korur. Tevkifat, verginin içindeki tutardır ve toplamın üzerine eklenmez. Başlıkta döviz ve şirket para birimi toplamları, kur ve yuvarlama ile birlikte saklanır.

Vergi kodu, tevkifat kodu, oran ve hesaplanmış tutar belge satırına anlık görüntü olarak yazılır. Vergi dahil fiyat için satırın `tax_inclusive` niteliği ayrıştırmayı belirler. `purchasing.rounding` `per_line` (varsayılan) veya `per_total` seçer. İkinci yöntemde aynı vergi kodundaki matrahlar toplanır, vergi bir defa yuvarlanır ve satırlara dağıtılır.

Fiyat, sipariş/RFQ kaynağından veya belge oluşturulurken girilen değerlerden oluşur. Kaynak sipariş ya da mal kabul satırındaki fiyatı farklılaştırmak `purchasing.price_override` izni gerektirir; gerekçe ve kullanıcı denetim bilgisiyle kaydedilir. Miktar, birim dönüşümü ve satır para tutarları sunucuda yeniden hesaplanır. Tedarikçi faturasında dışarıdan gelen tedarikçi fatura numarası ayrıca tutulur ve etkin satınalma faturaları arasında benzersizdir.

## Tedarikçi riski ve satınalma ilerlemesi

Tedarikçi maruziyeti saklanan bakiye değildir: açık tedarikçi faturaları ve borç dekontlarının net bakiyesi ile onaylı, henüz faturalanmamış siparişlerin şirket para birimindeki değeri hesaplanır. Bu bilgi amaçlıdır; maruziyet limiti işlemleri engellemez. `SupplierExposure` sözleşmesi de bu niteliği açıkça tanımlar.

Talep ilerlemesi, onaylı talep satırından siparişe dönüştürülmüş miktarı toplar. Sipariş ilerlemesi mal kabul ve fatura satırlarından izlenir. Fazla kabul, `purchasing.allow_over_receipt_percent` üst sınırı ile kontrol edilir; varsayılan %0'dır. Sipariş satırındaki kabul miktarını aşan değer bu toleransla sınırlandırılır. Kapanışta açık sipariş miktarı ilerleme durumuna göre sonlandırılır.

Tedarikçi performans verisi belirli dönem için zamanında/teslimat, fiyat ve iade metrikleri sunar. `SupplierPerformance` bunu yalnızca veri sözleşmesi olarak verir; maruziyet veya performans puanı kendi başına bloklama kuralı değildir.

## Stok ve muhasebe kaydı

Mal kabul post işlemi `StockService` üzerinden stok girişi (`purchase_receipt`) yapar; Purchasing stok tablolarına doğrudan yazmaz. Maliyet toplamı ve belge kimliği hizmet sonucundan alınır. Belge için belirleme olayı `purchase.goods_received`'dır; stok hesabı borçlandırılır, karşılık olarak GRNI tahakkuk hesabı alacaklandırılır. Varsayılan hesap planı kurallarında GRNI 381 hesabına, fiyat farkı 621 hesabına bağlanır; hesaplar `AccountDeterminer` ile ürün, kategori, depo ve diğer bağlama göre çözülür. Kural bulunamazsa kayıt tamamlanmaz.

Tedarikçi faturasının yevmiyesi `InvoiceJournal` ve `PostingService` üzerinden tek ana kayıt olarak üretilir. Mal kabulü olan satırlarda alınan malın fatura neti ile kayıtlı kabul maliyeti arasındaki değer fiyat farkıdır. Yevmiye, kabul maliyetini GRNI'den çıkarır; fatura neti ile kabul değeri farkını `purchase.price_variance` olayına (varsayılan 621) yazar. Fatura satırının bir mal kabul kaynağı yoksa net tutar `purchase.expense` (hizmet/stok dışı gider) hesabına borç yazılır.

Tipik satınalma faturası kaydı şöyledir: Dr GRNI (381) kabul maliyeti, Dr/Cr fiyat farkı (621) fatura neti ile kabul değeri farkı, Dr gider (kabul dışı satırlar), Dr indirilecek KDV (`purchase.vat_input`), Cr tedarikçi borcu (`purchase.payable`) ve varsa Cr tevkifat (`purchase.vat_withholding`). Fatura kabul değerinden ucuzsa fiyat farkı alacak olabilir. Borç hesabında cari, vade, döviz tutarı ve kur boyutları bulunur. Tevkifat borçtan düşülür. Yevmiye şirket para biriminde ve fatura tarihinde, açık muhasebe dönemi şartıyla gönderilir.

Faturanın aynı kabul satırını tamamen tüketen son faturası, yuvarlama artığını o satıra alır; böylece kabul maliyetinin toplamı GRNI'den tam çıkar. İade borç dekontu bunun ters yönündedir: iade edilen malın kayıtlı kabul maliyeti GRNI'yi alacaklandırır, fiyat farkı ve gider terslenir, KDV/borç yönü tersine döner. Borç dekontu `purchase_invoice` kaynağı ve ayrı amaçla kaydedilir; aynı belge için ikinci kez yevmiye üretmez.

Mal kabul iptali, stok hizmeti üzerinden ters hareket üretir ve yeni bir ters kayıt bağlantısı tutar. Fatura `reverse` işlemi `PostingService::reverse` ile ters yevmiye oluşturur; fatura satırları veya temel tutarları sonradan değiştirilmez. İade sevki, stok çıkışını Inventory üzerinden yapar. İade satırı bir mal kabul satırına bağlanmışsa, muhasebe tahakkuk çözümlemesi o kabul değerini kullanır.

## Numaralama, onay ve düzeltme

`DocumentKind` serileri ve numara aşamaları şöyledir: talep `PRQ`, RFQ `RFQ`, sipariş `POR`, mal kabul `GRN`, tedarikçi faturası `PIN`, borç dekontu `PDN`, satınalma iadesi `PRT`. Biçim seri + mali yıl + dokuz haneli sayaçtır (ör. `POR2027000000001`). Sayaç belge türü ve şirket kapsamındadır; fatura ile borç dekontu ayrı tür/seridir.

`purchasing.require_approval_over` yerel para tutarı eşiğidir; boş değer sipariş onayını kapatır. Eşiğe ulaşan sipariş `pending_approval` olur ve `ApprovalEngine`/Workflow sürecine gönderilir; eşik altı sipariş doğrudan onaylanır. `purchasing.request_approval_over` talep, `purchasing.invoice_approval_over` fatura için benzer eşikler sağlar. Onay sonucu listener üzerinden belge durumuna uygulanır. Sipariş onay olayı belge sahibine bildirim ve `PurchaseOrderApproved` olayı üretir.

Onaylanmış sipariş gönderilebilir, alınabilir ve faturalanabilir. Revizyon yalnızca mal kabul veya fatura bağlantısı yokken mümkündür. Taslak belge silinebilir; kayıtlı mal kabul ters stok hareketiyle iptal edilir. Deftere işlenmiş faturanın düzeltmesi ters yevmiye ve yeni belgeyle yapılır. Ters faturanın ters kayıt damgası yalnızca `booked` → `reversed` geçişinde yazılabilir. Ödeme uygulanmış fatura terslenemez; ödeme bağlantıları önce geri alınmalıdır.

## Veritabanı değişmezleri ve eşzamanlılık

Başlık ve satırlarda miktar pozitifliği, kur pozitifliği, fiyat ve iskonto sınırları, satır `line_total = net_amount + tax_amount`, başlık `total = subtotal - discount_total + tax_total` ve tevkifatın vergi/toplam sınırı CHECK kısıtlarıyla korunur. Şirket ve numara (fatura türü dahil) için benzersiz kısmi indeksler vardır. Aynı tedarikçi faturası numarası, iptal veya terslenmiş kayıtlar dışında şirket ve cari kapsamında bir kez kullanılabilir.

Sipariş, kabul, fatura ve iade durumları DB CHECK kısıtlarıyla geçerli enum değerleriyle sınırlandırılır. Post edilmiş mal kabulde numara ve stok belgesi zorunludur. Deftere işlenmiş faturada numara ve yevmiye zorunlu; açık borçta `balance_due = total - withholding_total - paid_amount`; ters faturada ödenen ve bakiye tutarları sıfır olmalıdır. Ödeme uygulama tutarı pozitiftir ve aynı şirket/fatura/referans bileşimi tekrarlanamaz.

`2027_04_01_100200_create_purchasing_invariants.php` tetikleyicileri, taslak dışı faturanın ve satırlarının değiştirilmesini/silinmesini, post edilmiş mal kabulün veya satırlarının değiştirilmesini engeller. Fatura başlığında yalnızca durum, ödeme bakiyesi, sürüm/zaman ve sınırlı e-belge/ters kayıt alanları izin verilen geçişlerde değişebilir. Fatura satırları, fatura `draft` veya `pending_approval` iken düzenlenebilir. Mal kabul yalnızca `posted` → `cancelled` ters hareket geçişine izin verir. Satır tetikleyicileri üst belgeyi `FOR SHARE` ile kilitleyerek post işlemiyle yarışan satır değişikliklerini bekletir. SQLSTATE `KP001`–`KP003` bu koruma ihlallerini belirtir. 100300 geçişi ters kayıt alanlarının damgasını yalnızca gerçek tersleme geçişine sıkılaştırır.

Talep, RFQ, sipariş ve faturaya ait kaynak miktarları ilişkili satırlar ve şirket kapsamı üzerinden doğrulanır. Belge eylemleri transaction içinde yürütülür; eylem POST'ları idempotency middleware kullanır. Muhasebe PostingService kaynak/amaç anahtarıyla yinelenen post işlemini önler. Olaylar commit sonrasında yayımlanır; rollback olmuş işlem için dış dinleyiciye başarılı kayıt görünmez.

## API ve izinler

API `/api/v1` altındadır; oturum (`auth:sanctum`), parola değişikliği (`password.changed`) ve şirket kapsamı (`company`) middleware'leri uygulanır. Kaynaklar `purchase-requests`, `purchase-rfqs`, `purchase-orders`, `purchase-receipts`, `purchase-invoices`, `purchase-returns` uçlarıdır. Liste, detay, CSV/XLSX dışa aktarma ve uygun belgelerde yazdırma modeli vardır. Dışa aktarma `purchasing.export_max_rows` ile 50.000 satırla sınırlıdır.

Eylemler: talep `submit/cancel/rfq/orders`; RFQ `send/cancel/quotes/award/comparison`; sipariş `submit/revise/send/cancel/close/receipts/invoices`; mal kabul `post/cancel/invoice/returns`; fatura `book/reverse/cancel/returns/match`; iade `approve/ship/debit/cancel`. Kaynaktan yeni belge üretimi hedefte `create`, kaynakta `view` izni ister. Yazma ve eylem POST'ları `Idempotency-Key` ile yinelenmeye dayanıklı çalışır. Ek uçlar `POST /purchase-documents/preview-totals`, `GET /suppliers/{id}/exposure`, `/purchase-summary`, `/performance` şeklindedir.

İzinler kaynak ve eylem bazındadır: `purchasing.requests.*`, `purchasing.rfqs.*`, `purchasing.orders.*`, `purchasing.receipts.*`, `purchasing.invoices.*`, `purchasing.returns.*`. Özel eylemler `purchasing.rfqs.award`, `purchasing.receipts.post/reverse`, `purchasing.orders.approve`, `purchasing.invoices.book/reverse`, `purchasing.returns.approve/ship/debit`; ayrıca `purchasing.match_override`, `purchasing.price_override` ve `purchasing.reports.view` vardır. Varsayılan rol atamaları `permissions.php` içindedir; yönetici katalogdaki tüm izinleri alır.

Modül sözleşmeleri `PayableSettlement` ile hazine modülüne fatura bazında ödeme uygulama/geri alma, `PurchaseInvoiceLookup` ile açık cari faturalarını bulma, `SupplierExposure` ile hesaplanan maruziyet ve `SupplierPerformance` ile dönem performansı sağlar. Ödeme başvuruları (invoice, reference) anahtarıyla idempotenttir. `PurchaseInvoiceBooked`, `PurchaseInvoiceReversed`, `PurchaseOrderApproved`, `PurchaseReceiptPosted` ve `PurchaseReturnDebited` olayları commit sonrası yayınlanır. Fatura olayı tedarikçi/yevmiye/yerel toplamı; kabul olayı stok belgesi ve maliyet toplamını; iade olayı borç dekontunu taşır.

## Şirket ayarları

| Ayar | Varsayılan / kapsam |
|---|---|
| `purchasing.allow_direct_receipt` | `false`; siparişsiz doğrudan mal kabul |
| `purchasing.match_mode` | `warn`; `off`, `warn`, `block` |
| `purchasing.match_qty_tolerance_percent` | `0`; miktar toleransı, %0–100 |
| `purchasing.match_price_tolerance_percent` | `0`; birim net fiyat toleransı, %0–100 |
| `purchasing.allow_over_receipt_percent` | `0`; fazla mal kabul, 0–100 |
| `purchasing.require_approval_over` | Boş; sipariş onayının yerel tutar eşiği |
| `purchasing.request_approval_over` | Boş; talep onayının yerel tutar eşiği |
| `purchasing.invoice_approval_over` | Boş; fatura onayının yerel tutar eşiği |
| `purchasing.default_warehouse_id` | Boş UUID; varsayılan depo |
| `purchasing.rounding` | `per_line`; alternatif `per_total` |
| `purchasing.export_max_rows` | 50.000 satır; modül yapılandırması |

Ayar tanımları Settings kayıt mekanizmasına `purchasing` grubu ile eklenir. Tutar eşiklerinde boş değer “eşik yok” anlamına gelir; toleranslar yüzde metni olarak doğrulanır. Şirket para birimi `company.base_currency` üzerinden okunur, geçersiz değer için `TRY` kullanılır.

## Bilinen sınırlamalar

- Gönderilmiş satınalma iadelerinin stok çıkış maliyeti mevcut ortalama maliyet üzerinden hesaplanır; özgün alış maliyet katmanını takip ederek birebir tersleme yapılmaz.
- `receive_on_invoice` ile faturada otomatik mal kabul, lot veya seri izlemeli ürünler için desteklenmez.
- Üç yönlü eşleşme, sipariş fiyatı ile fatura net birim fiyatını ve sipariş/kabul miktarlarını karşılaştırır; siparişe bağlanmamış satır `unmatched` olur.
- `purchasing.match_mode=block` farkta 422 ile durdurur; `purchasing.match_override` yetkisi ve gerekçesi farkı aşabilir. `warn` kayıtla birlikte uyarı üretir, `off` eşleştirme sonucunu kayıt kararında dikkate almaz.
- Tedarikçi maruziyeti bilgilendirme amaçlıdır; limit denetimi ve otomatik bloklama uygulanmaz.
- Kayıtlı fatura ve post edilmiş mal kabul değişmezdir; düzeltme ters kayıt ve yeni belgeyle yapılır.
- Ödeme mutabakatı fatura para biriminde, açık faturanın kalan bakiyesiyle sınırlıdır; ödeme işleminin nakit/banka yevmiyesi bu modülün sözleşmesinin dışındadır.

### Talep ve RFQ ayrıntıları

Talep satırları ürün, ölçü birimi, baz miktar ve tahmini fiyat/toplam bilgisi taşır. Talep onayına kadar `draft` ve `pending_approval` durumları düzenlenebilir. Reddedilen talep tekrar taslağa çevrilerek yeniden sunulabilir; iptal edilmiş belge dönüştürme kaynağı olamaz.

RFQ, tedarikçi davetlerini ve her tedarikçinin yanıt durumunu ayrı satırlarda tutar (`invited`, `responded`, `declined`). Teklif fiyatı, iskonto yüzdesi ve teslimat/yanıt bilgileri RFQ teklifi olarak saklanır. Karşılaştırma ucu satır ve tedarikçi tekliflerini birlikte sunar; `award` seçilen teklifi siparişe dönüştürür. Ödüllendirme hem `purchasing.rfqs.award` hem sipariş oluşturma yetkisi ister.

### Siparişin ilerleme hesabı

Sipariş oluşturulurken kaynağı talep, RFQ veya doğrudan kullanıcı girişi olabilir. Talep dönüşümünde daha önce sipariş edilen miktar düşülür; aynı talep miktarının paralel siparişlerle aşılmaması için kaynak miktarları yeniden doğrulanır.

Siparişin `approved` olması satınalma yetkisini, `sent` tedarikçiye iletildiğini gösterir. Mal kabul miktarı sipariş miktarına göre ilerler; tüm miktar alınmışsa `received`, bir bölümü alınmışsa `partially_received` görünür. Faturalama ilerlemesi benzer biçimde `partially_invoiced` veya `invoiced` olur. Bu durumlar `OrderProgress` tarafından kaynak belgelerden yeniden hesaplanır.

Sipariş `close` eylemi açık miktarları sonlandırır; `cancel` kullanılmamış siparişi iptal eder. Revizyon, eski siparişi ve yeni taslak sürümünü ilişkilendirir; kabul/fatura referansı mevcutsa revizyon reddedilir. Sipariş satırlarında `received_quantity` ve `invoiced_quantity` ilerleme hizmetince hesaplanır; DB kısıtı bu değerlerin negatif olmamasını sağlar.

### Mal kabul ayrıntıları

Mal kabul siparişten üretildiğinde kaynak sipariş satırı ve kabul miktarı bağlanır. `allow_direct_receipt` kapalıyken kaynağı olmayan kabul oluşturulamaz. Kabul başlığındaki depo Inventory stok hareketi için kullanılır; satır düzeyindeki depo alanı belirleme bağlamı sağlar.

`post` işleminde miktarlar kaynak sipariş satırının kalan alınabilir miktarıyla denetlenir. Fazla kabul toleransı bu miktara yüzde olarak eklenir. İşlem tek veritabanı kapsamı ve stok servisi üzerinden yürür; başarılı sonuçtaki stok belge kimliği mal kabul başlığına yazılır.

Post edilmiş mal kabul `cancel` edilirse Inventory ters stok belgesi oluşturulur, tersleme tarihi ve kullanıcı kaydedilir, sipariş ilerlemesi tekrar hesaplanır. DB tetikleyicisi posted durumundan yalnızca bu kontrollü iptal geçişini kabul eder; satırlar hiçbir zaman post sonrasında değiştirilemez.

### Fatura ve eşleştirme ayrıntıları

Fatura, siparişten, mal kabulden veya izin verilmiş doğrudan girişten oluşturulabilir. Satırda sipariş satırı, mal kabul satırı ve kaynak/orijinal satır bağları ayrı tutulur. Hizmet ve stok dışı satırların mal kabul satırı olmayabilir. Tedarikçi fatura no, cari ve şirket kapsamı ile tutulur.

Üç yönlü eşleştirme her fatura satırını sipariş satırındaki net birim fiyat ve miktarla karşılaştırır. Stok kaleminde mal kabul bağlantısı varsa miktar referansı alınan miktardır; aksi durumda sipariş miktarı kullanılır. Aynı sipariş satırına ait daha önceki açık/deftere işlenmiş faturalar da toplam faturalanan miktara eklenir.

Fiyat farkı, sipariş net birim fiyatına göre yüzde mutlak farktır. Sipariş fiyatı sıfırsa fatura fiyatı da sıfır olmalıdır; aksi fark %100 kabul edilir. Tolerans üstündeki miktar `qty_variance`, fiyat farkı ise `price_variance` üretir. Siparişsiz satır `unmatched` sayılır. Belge sonucu satırların en ağır durumudur; ağırlık sırası miktar, fiyat, eşleşmemiş, eşleşmiş şeklindedir.

`match_mode` `off`, `warn` veya `block` seçer. `block` modunda uyuşmazlık muhasebe kaydını durdurur; özel izin `purchasing.match_override` ve açıklanmış gerekçe ile aşım yapılabilir. Eşleşme sonucu ve ayrıntıları fatura/satır üzerinde saklanır ve `GET .../{id}/match` ile okunabilir.

Fatura `book` öncesi onay eşiğini ve eşleşmeyi kontrol eder, yevmiye dağılımını hesaplar, numara atar ve PostingService ile kaydeder. Fatura para birimindeki tedarikçi toplamı `total - withholding_total` kadar borç oluşturur. `PayableSettlement` ödemeleri bu tutardan düşürür; tam kapama `paid`, kısmi kapama `partially_paid` olur.

### İade ve borç dekontu ayrıntıları

İade, fatura veya mal kabul kaynağından açılabilir ve ilgili kaynak satıra/depoya bağlanır. İade onayı sevkiyat değildir: `approved` durumundan depo rolündeki kullanıcı `ship` eylemiyle stok çıkışını yapar. Bu aşama `shipped` olur; muhasebe borç dekontu ayrı `debit` eylemiyle muhasebe rolü tarafından kesilir.

Kaynak faturaya bağlı iade satırında fatura satırı, mal kabulden gelen iadede kabul satırı tutulur. İade edilen miktar kaynak satırın daha önce iade edilmemiş miktarını aşamaz. Borç dekontu ayrı `PDN` serisi ve fatura yaşam döngüsüyle üretilir; iade kaydı bu dekontun kimliğini tutar.

Stok hareketi ile borç dekontu farklı adımlardır: mal fiilen gönderilmeden borç dekontu kesilmez. İade iptali yalnızca muhasebe ve stok aşamalarına geçmeden yapılabilir. `PurchaseReturnDebited` olayı iade kimliği, dekont kimliği ve yerel toplamı bildirir.

### Ödeme ve okuma sözleşmeleri

`PayableSettlement::apply` tutarı pozitif, açık bakiyeden küçük/eşit ve fatura para biriminde olmalıdır. Aynı referans ikinci kez uygulanırsa ilk sonuç döner; `unapply` da yinelenen geri alma çağrısını güvenli karşılar. Uygulama kayıtları `purchase_payable_applications` tablosunda tutulur.

`PurchaseInvoiceLookup::openForParty` yalnızca `booked` veya `partially_paid` olup bakiyesi bulunan tedarikçi faturalarını ve borç dekontlarını vade tarihi eskiden yeniye sunar. `find` aktif şirket kapsamındaki fatura görünümünü sağlar. Ters veya iptal edilmiş belge açık borç listesine dahil değildir.

Ödeme sözleşmesi ödeme emri/banka kaydı yaratmaz. Bu modülün sorumluluğu fatura başlığındaki `paid_amount` ve `balance_due` değerlerini korumak, tekrarları önlemek ve belge durumunu güncellemektir.

### Tutarların API temsili

Belge başlığı döviz kodu, altı basamaklı kur, fatura tarihi, ödeme koşulu/vade, tedarikçi adı ve vergi tanımlayıcı görüntülerini saklar. Satırlar stok/servis türü, varyant, miktar, birim, baz miktar, vergi/tevkifat kodu ve kaynak satır kimliklerini taşır.

API kaynaklarına yazılan para ve miktar alanları ondalık metin biçiminde ele alınır; istemci toplamları doğrulama için gönderse bile sunucu toplam motoruyla tekrar hesaplar. `preview-totals` belge kaydetmeden aynı hesaplamanın ön izlemesini verir.

Detay kaynakları satırlar, kaynak bağlantıları, eşleşme bilgisi ve durum alanlarını sunar. Yazdırma modeli sipariş, mal kabul, fatura ve iade için vardır; talep ve RFQ rotalarında print-model tanımlanmamıştır. Liste/dışa aktarma şirket ve izin kapsamındaki kayıtlarla sınırlıdır.
