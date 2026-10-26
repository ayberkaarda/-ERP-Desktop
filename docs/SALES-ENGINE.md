# Satış motoru

Bu belge satış belgelerinin yaşam döngüsünü, stok ve muhasebe bağlantılarını ve API sözleşmesini açıklar. Tutarlar `numeric(20,4)`, miktarlar `numeric(20,6)`, kurlar `numeric(20,6)` biçiminde saklanır; kimlikler UUIDv7, tüm kayıtlar şirket kapsamındadır. Para ve miktar API'de ondalık metin olarak taşınır.

## Belge zinciri ve durumlar

| Belge | Durumlar | Temel geçiş |
|---|---|---|
| Teklif | `draft`, `sent`, `accepted`, `rejected`, `expired`, `converted`, `cancelled` | Gönder, kabul/ret, revize et veya siparişe dönüştür. Revizyon yeni taslak üretir ve önceki sürümü iptal eder. |
| Sipariş | `draft`, `pending_approval`, `confirmed`, `partially_delivered`, `delivered`, `partially_invoiced`, `invoiced`, `closed`, `cancelled` | Onay isteği, onay/teyit, kısmi sevk/faturalama, kapatma veya iptal. Teslim ve faturalama miktarları sunucu tarafından tutulur. |
| İrsaliye | `draft`, `posted`, `cancelled` | Kaydetme stok çıkışı ve maliyet kaydı yapar; kayıtlı irsaliye ancak ters stok hareketiyle iptal edilebilir. Doğrudan irsaliye ayara bağlıdır. |
| Fatura | `draft`, `pending_approval` (kullanılmıyor), `issued`, `partially_paid`, `paid`, `cancelled`, `reversed` | Kesme kayıt ve yevmiye oluşturur. Tahsilat durumları sonraki fazın mutabakat sözleşmesi içindir. |
| İade | `draft`, `approved`, `received`, `credited`, `cancelled` | Onayla, malı teslim al, ardından alacak dekontu oluştur. |
| Alacak dekontu | Faturanın `return` türü; kendi `draft`, `issued`, `partially_paid`, `paid`, `reversed` yaşam döngüsü | İade kredilendirilince ayrı numara ve bakiye ile hemen kesilir; asıl faturaya otomatik mahsup edilmez. |

Taslaklar düzenlenebilir; değişiklikte sürüm (`version`) zorunludur. Geçersiz geçiş 422, sürüm çakışması 409 döndürür. Onaylanmış sipariş `revise` ile yeniden taslağa alınabilir; üzerinde herhangi bir teslimat veya fatura referansı varsa revizyon reddedilir. Kaynak belgeye bağlı satırlarda istemcinin gönderdiği fiyat/iskonto kullanılmaz; kaynak değerleri korunur.

## Tutar, vergi ve fiyat

Hesaplamalar kayan nokta kullanmadan BigDecimal ile, yarım yukarı yuvarlama ve iki ondalıklı işlem hassasiyetiyle yapılır. Satır brütü miktar × birim fiyat, iskonto yüzdesi ve girilen iskonto düşüldükten sonra net tutar elde edilir. Vergi, net matrah üzerinden hesaplanır; satır toplamı net + vergidir. Başlık toplamı satırların toplamıdır ve `subtotal - discount_total + tax_total` eşitliğini korur. Yerel para tutarları kurla çevrilip yuvarlanır. Vergi kodu belge tarihindeki geçerli orandan bulunur ve belgeye anlık görüntü olarak yazılır. Açıkça `tax_code_id: null` vergisiz satır demektir; alanın atlanması ürünün varsayılanını kullanır. İade/alacak dekontu özgün vergi oranını taşır.

`sales.rounding` ayarı `per_line` veya `per_total` seçer (varsayılan `per_line`). `per_total`, yalnızca vergi hariç satırların net matrahlarını vergi kodu bazında toplayıp vergiyi hesaplar ve satırlara dağıtır; vergi dahil fiyatlı satırlar satır bazında kalır. Vergi dahil fiyatın ayrıştırılması çözümlenen fiyatın `taxInclusive` niteliğini izler.

Birim fiyat boşsa `PriceResolver` cari fiyat listesini, ardından varsayılan listeyi değerlendirir. Çözümlenmiş fiyat yoksa elle girilen fiyat kullanılabilir; fiyat da yoksa doğrulama hatası oluşur. Çözümlenmiş fiyattan farklı açık fiyat için `sales.price_override` gerekir ve işlem denetim kaydına yazılır. Başlıktaki `price_list_id` bilgi amaçlıdır; çözümleyici kendi cari/varsayılan liste sırasını kullanır. Vergi oranı yeni belge tarihinde yeniden bulunur; fiyat ve iskonto kaynak belgeden kopyalanır.

## Müşteri riski ve rezervasyon

Risk maruziyeti saklanan bakiye değil, hesaplanan değerdir: açık satış faturalarının bakiyesi eksi açık alacak dekontları, artı teyit edilmiş (ve onay bekleyen) siparişlerin henüz faturalanmayan kısmı. Tutarlar cari risk para birimine güncel kurla çevrilir. Risk limiti olmayan müşteri sınırsızdır; etkin olmayan veya müşteri rolü olmayan cari kullanılamaz.

`sales.credit_check_mode`: `off`, `warn` (varsayılan) veya `block`. Kontrol sipariş teyidinde ve satış faturası kesiminde yapılır. `warn` uyarıyla devam eder; `block` 422 `sales.credit_limit_exceeded` verir. `sales.credit_override` izni olan kullanıcı gerekçe yazarak aşımı geçebilir; gerekçe ve kullanıcı denetlenir. Kontrol aynı müşteri için advisory lock altında yapılır. Bekleyen siparişin onayı tamamlanırken limit yeniden kontrol edilir; blok varsa yalnızca başvuruda yetkili aşım gerekçesi verilmiş olması ilerlemeye izin verir.

`sales.reserve_on_confirm` varsayılan olarak açıktır. Sipariş teyidinde Inventory rezervasyon hizmeti depo politikasına göre sert/yumuşak rezervasyon yapar. İrsaliye kaydı ilgili rezervasyonu tüketir; iptal/kapatma kalan miktarı serbest bırakır. İrsaliye tersinde açık sipariş miktarı, ayar ve depo politikası izin verirse yeniden rezerve edilir. Rezervasyon başarısızlığı veya stok yetersizliği uyarı olarak dönebilir; onay tamamlanırken stok ayırılamazsa sipariş rezervasyonsuz teyit edilir ve bu durum kaydedilir.

## Stok ve muhasebe kaydı

İrsaliye kaydı tek işlem içinde `StockService::post` ile stok çıkışı yapar. Satış modülü stok veya yevmiye tablolarına doğrudan yazmaz. Stok hizmeti maliyet katmanını belirler; satır maliyeti ve toplam maliyet sonuçtan alınır. Olay `inventory.cogs` ile maliyet kaydını oluşturur ve irsaliyede yevmiye bağlantısı tutulur.

Satış faturası kesimi, `PostingService` üzerinden tek yevmiye oluşturur: borç `sales.receivable` (cari, vade; yabancı parada kur ve döviz tutarıyla), alacak `sales.revenue.goods` veya `sales.revenue.services` (net tutar; belirleme kuralına göre), vergi kodu başına alacak `sales.vat_output`. İskonto net gelire dahildir. Alacak dekontunda gelir yerine `sales.returns` borçlandırılır; vergi ve alacak hesabı ters yönde kaydedilir. Hesaplar `AccountDeterminer` kurallarıyla çözülür; çözülemeyen hesapta kayıt yapılmaz. Dönem açık olmalıdır.

İade mal kabulünde özgün teslimatın birim maliyetiyle `return_in` hareketi yapılır. Aynı stok kaydı `inventory.cogs` karşı hesabıyla COGS'u tersler (ör. Dr stok / Cr COGS); bu ters kayıt alacak dekontu kesiminde değil mal kabulündedir. İade kredilendirme ayrı bir alacak dekontu üretir.

## Numaralama, onay ve düzeltme

Belge numarası kaydedilme/kesilme gibi ilgili aşamada, `NumberSequenceService` ile belge tarihi yılının sayacından atanır; başarısız işlem numarayı tüketmez. Biçim seri + yıl + dokuz hane şeklindedir: `QUO`, `ORD`, `DLV`, `INV`, `CRN`, `RET`. Teklif numarası gönderme/kabul/dönüştürmede, sipariş teyidinde, irsaliye kaydında, fatura/alacak dekontu kesiminde ve iade onayında verilir.

`sales.require_approval_over` yerel para cinsinden eşik değeridir; boş değer onayı kapatır. Eşiğe ulaşan sipariş `ApprovalEngine` üzerinden `pending_approval` olur. Onay tamamlanınca limit tekrar denetlenir ve sipariş teyit edilir; ret siparişi taslağa döndürür. Onay sonucu belge sahibine bildirilir. Fatura onayı henüz uygulanmamıştır.

Kesilmiş fatura değiştirilemez. `reverse`, `PostingService::reverse` ile ters yevmiye üretir; gerekirse ve stok hizmeti izin verirse faturanın kapsadığı teslimatları da tersler. Ödeme uygulanmış faturanın veya iptal edilmemiş iadesi bulunan faturanın terslenmesi reddedilir. Alacak dekontu da terslenebilir; buna bağlı iade yeniden `received` durumuna döner. İrsaliye tersinde stok ters kaydı ve rezervasyon yenileme değerlendirilir. Düzeltme için kayıtlı belgeyi düzenlemek yerine ters kayıt veya iade/alacak dekontu kullanılır.

## Veritabanı değişmezleri ve eşzamanlılık

Veritabanı pozitif miktarı, satır toplamı = net + vergi, başlık toplamı özdeşliği, açık faturada bakiye = toplam - ödenen ve ters faturada sıfır bakiye kurallarını denetler. Şirket ve belge türü başına numara benzersizdir. Tetikleyiciler kesilmiş fatura ve satırlarının, kayıtlı irsaliye ve satırlarının güncellenmesini/silinmesini engeller; ihlaller API'de 422'ye çevrilir.

Kaynak miktar sınırları kaynak başlık satır kilidi altında hesaplanır. Kilit sırası sipariş → irsaliye → fatura şeklindedir; iade sınırı fatura kilidi altında hesaplanır. Birden çok belgeyi aynı anda dönüştürme, teslim veya faturalama miktarını aşamaz. Kredi kontrolü müşteri başına advisory lock ile serileştirilir. Satır tetikleyicileri üst belge için `FOR SHARE` alır; kesim/kayıt sürerken satır değişikliği bekler ve sonrasında değişmez kuralına takılır. Tüm kayıt ve dönüşümler işlem sınırında, idempotent yürütülür; aynı anahtar veya tamamlanmış durum ikinci stok/yevmiye üretmez. Olaylar commit sonrasında yayınlanır.

## API ve izinler

API `/api/v1` altındadır; oturum, parola değişikliği ve şirket kapsamı zorunludur. Kaynaklar `sales-quotes`, `sales-orders`, `sales-deliveries`, `sales-invoices`, `sales-returns` uçlarıdır. Ortak işlemler listeleme, detay (satırlar, bağlantılar, uyarılar, denetim izi), taslak oluşturma/düzenleme/silme ve yazdırma modelidir. Dönüştürme ve eylem uçları teklif `send/accept/reject/revise/convert`, sipariş `confirm/revise/cancel/close/deliveries/invoices`, irsaliye `post/cancel/invoice`, fatura `issue/reverse/cancel/returns`, iade `approve/receive/credit` biçimindedir. Her yazan/dönüştüren POST `Idempotency-Key` ister. Ayrıca `POST /sales-documents/preview-totals`, `GET /customers/{id}/exposure` ve `/sales-summary` bulunur. Liste filtreleri durum, cari, para birimi, depo, tarih, numara, ürün ve aramayı; CSV/XLSX dışa aktarma belge başlığı satırlarını destekler ve 50.000 satırla sınırlıdır.

İzinler kaynak ve eylem bazındadır: `sales.quotes.*`, `sales.orders.*`, `sales.deliveries.*`, `sales.invoices.*`, `sales.returns.*`; ayrıca `sales.price_override`, `sales.credit_override`, `sales.reports.view`. Onay, kesim, ters kayıt, mal kabul ve kredilendirme için ilgili `approve`, `issue`, `reverse`, `receive`, `credit` eylemleri aranır. Dönüştürme kaynak belgeyi görüntüleme ve hedef belge oluşturma izinlerini birlikte ister. Yönetici varsayılan olarak fiyat/risk aşım izinlerine sahiptir.

## Şirket ayarları

| Ayar | Varsayılan / kapsam |
|---|---|
| `sales.allow_direct_delivery` | `false`; siparişsiz irsaliye |
| `sales.credit_check_mode` | `warn`; `off`, `warn`, `block` |
| `sales.reserve_on_confirm` | `true` |
| `sales.require_approval_over` | Boş; yerel tutar eşiği, boşsa onay yok |
| `sales.default_warehouse_id` | Boş UUID |
| `sales.quote_validity_days` | 30 gün |
| `sales.allow_over_delivery_percent` | %0; 0–100 aralığı |
| `sales.rounding` | `per_line`; alternatif `per_total` |

## Bilinen sınırlamalar

- Fatura onay akışı, satış satırlarında tevkifat ve e-belge işlemleri yoktur; e-belge alanları sonraki entegrasyon için ayrılmıştır.
- Para birimi hassasiyeti her para birimi için iki ondalıkla sabittir.
- Dışa aktarma belge başlığı düzeyindedir; satır dışa aktarımı sunulmaz.
- Bekleyen sipariş iptali Workflow talebini kapatmaz; sonraki onay olayı dinleyici tarafından yok sayılır.
- Faturada otomatik teslim (`deliver_on_invoice`) seri takipli ürünleri desteklemez; lotlu ürünler FEFO ile seçilir.
- İrsaliyede tüm satırlar başlık deposundan çıkar; satır depo geçersiz kılma alanı kullanılmaz.
- Fatura ve alacak dekontları ayrı bakiyelidir; kredi asıl faturaya otomatik uygulanmaz.
