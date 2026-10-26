# e-Belgeler

e-Dönüşüm modülü, mevcut satış belgelerinden UBL-TR XML üretimi, resmî şemalarla yapısal doğrulama ve yerel sandbox iş akışını sağlar. `EDOCUMENTS_DRIVER=sandbox` varsayılandır. Sandbox gönderimleri GİB'e veya bir özel entegratöre iletilmez.

## Kapsam

| Belge | Kaynak | Senaryo |
|---|---|---|
| e-Fatura | Kesinleştirilmiş satış faturası | Temel, ticari, ihracat, kamu |
| e-Arşiv | Kesinleştirilmiş satış faturası | e-Arşiv fatura |
| e-İrsaliye | Stok hareketi işlenmiş satış irsaliyesi | Temel irsaliye |

İptal edilmiş veya ters kaydı oluşturulmuş kaynaklar gönderilemez. Kaynak belgenin fiyatları, vergileri ve toplamları XML üretimi sırasında yeniden hesaplanmaz. Desteklenmeyen bir vergi veya eksik senaryo bilgisi, sessizce farklı bir değere çevrilmek yerine doğrulama hatası verir.

Yerel gelen kutusu XML içe aktarma, sandbox kuyruğunu sorgulama ve uygun ticari faturaya kabul/ret yanıtını destekler. Gelen fatura mevcut satın alma faturasıyla açık kullanıcı işlemiyle eşleştirilebilir; bu işlem otomatik muhasebeleştirme veya ödeme oluşturmaz.

## Doğrulama çalışma ortamı

PHP 8.4, DOM/libxml ve Java JDK 21 önerilir. Saxon çalışma ortamı, uygulama isteği sırasında indirilmez. `backend/` dizininden açıkça kurun:

```sh
php scripts/install-edocument-runtime.php
php scripts/install-edocument-runtime.php --verify-only
```

Kurucu sabit HTTPS adreslerinden indirdiği dosyaların SHA-256 değerlerini `Resources/runtime-manifest.json` ile karşılaştırır. Çalışma dosyaları `storage/app/edocuments/runtime/` altında tutulur. JDK gereklidir: güvenli doğrulayıcı başlatıcısı Java kaynak dosyası çalıştırma özelliğini kullanır.

UBL XSD'leri ve şematron kaynakları modülün `Resources/` dizininde sürümlenir. XPath 2 kuralları Saxon ile çalıştırılır; PHP XPath 1 motoruyla taklit edilmez. Kurulumdan sonra belge doğrulaması çevrimdışıdır. Çalışma ortamı veya gerekli dosya eksikse doğrulama kullanılamaz olarak bildirilir; belge doğrulanmış sayılmaz.

e-Arşiv faturasının UBL `Invoice` doğrulaması ile e-Arşiv raporlama paketi farklı kapsamlardır. Bu modül, e-Arşiv rapor gönderimini veya canlı entegratör mutabakatını uyguladığını iddia etmez.

## İmza ve canlı bağlantı

Sandbox XML'i mali mühürle imzalanmış bir belge değildir. XSD ve şematron başarısı, kriptografik imza doğrulaması veya belgenin hukuki geçerliliği anlamına gelmez. Doğrulama bilgisi bu ayrımı korur; imza doğrulanmamışsa `signature_verified=false` bildirilir.

`EDocumentProvider` sözleşmesi sağlayıcı işlemlerini uygulamadan ayırır. Mevcut sürücü yerel sandbox'tır. Canlı kullanım için seçilen özel entegratörün protokolünü, kimlik doğrulamasını ve imzalama sürecini uygulayan bir adaptör gerekir. Yalnızca rastgele bir servis adresi veya API anahtarı yazmak canlı gönderim açmaz; desteklenmeyen sürücüler kapalı davranır.

## Giden belge akışı

1. E-belgeler ekranından türü ve uygun kaynak belgeyi seçin.
2. Senaryonun gerektirdiği adres, sevkiyat veya diğer iş bilgilerini doldurun.
3. Doğrulamayı çalıştırın; şema ve şematron hatalarını inceleyin.
4. Hazır belgeyi sandbox'a gönderin ve durumunu sorgulayın.
5. Sabitlenen XML'i indirin veya güvenli belge görünümünü açın.

E-belge UUID'si ve numarası satış belgesinin iç numarasından ayrıdır. Numara şirket, belge ailesi, seri ve yıl kapsamındadır: e-Fatura ve e-Arşiv aynı fatura sayacını, e-İrsaliye ayrı sayacı kullanır. Başarısız doğrulama numara tüketmez. Gönderime hazırlanan içerik sabitlenir; tekrar denemeler aynı XML, UUID ve sağlayıcı istek kimliğini kullanır.

Henüz sağlayıcıya gönderilmemiş bir belge yerel olarak iptal edilebilir. Bu işlem hukuki iptal değildir; ayrılmış numara ve denetim geçmişi korunur. Gönderilmiş belge için aynı yerel iptal işlemi kullanılamaz.

Desteklenen fatura türleri normal satış ve iadedir. Tevkifat, desteklenmeyen vergi/bedel yapıları veya yasal XML hassasiyetiyle temsil edilemeyen kaynak tutarları açıkça reddedilir. İade için asıl fatura numarası ve tarihi gerekir. Kaynak miktar, fiyat, indirim ve KDV tutarlarının tutarlılığı ayrıca denetlenir.

Gönderim iddiası kaynak belgeyle birlikte kilitlenir. Devam eden veya tamamlanan e-belge gönderimi varken kaynak satış belgesinin ters kaydı/iptali normal iş akışı üzerinden engellenir. Hazır ama henüz gönderilmemiş kaynağın uygunluğu gönderim öncesinde yeniden kontrol edilir.

Sandbox durumları yerel test sonuçlarıdır. Yerel simülasyon ile ticari alıcının iş yanıtı aynı işlem olarak sunulmaz.

## Şirket ve izin sınırları

Tüm kayıtlar aktif şirket kapsamındadır. Giden belgeye erişim, e-belge izninin yanında kaynak satış belgesini görme yetkisini de gerektirir. Gönderme, doğrulama, içe aktarma, yanıtlama ve sandbox yönetimi ayrı izinlerle yönetilir. Yeniden gönderilen bir istek önbellekten dönse bile güncel erişim ve hesap durumu denetlenir.

Kullanıcı değişiklikleri iyimser sürüm denetimi ve `Idempotency-Key` kullanır. Aynı işlem tekrarlandığında ikinci belge veya ikinci sağlayıcı gönderimi üretilmez. Kaynak belge veya istek içeriği değişmişse eski işlem sessizce yeniden uygulanmaz.

Gelen XML'in alıcısı aktif şirketin kimliğiyle eşleşmelidir. Aynı UUID ve aynı içerik yinelenen kayıt oluşturmaz; aynı UUID altında farklı içerik çakışma olarak reddedilir. Satın alma eşleştirmesinde şirket, tedarikçi, para birimi ve tutar uyumluluğu kontrol edilir.

Mevcut kurulumlarda yeni izinleri katalog ve Admin rollerine eklemek için migration sonrasında çalıştırın:

```sh
php artisan db:seed --class='App\Modules\Identity\Database\seeders\IdentitySeeder'
```

Diğer mevcut rollerin özelleştirilmiş izinleri korunur; gerekli e-belge izinlerini yönetim ekranından ayrıca verin.

## XML güvenliği

XML boyutu sınırlıdır. DTD ve haricî varlıklar kabul edilmez. Şemalar, şematronlar ve kod listeleri güvenilen yerel dosyalardan yüklenir. Kullanıcı XML'iyle gelen uzak şema veya XSLT adresleri çalıştırılmaz. Belge görünümü ham XML/HTML betiklerini tarayıcıda yürütmez.

Mükellef sorgusu sandbox'taki yerel dizini kullanır. Sonuçlar canlı GİB kayıt sorgusu olarak gösterilmez. Yerel dizin kayıtlarını ve gelen kutusu test belgelerini yönetmek ayrı sandbox yönetim yetkisi gerektirir.

## Resmî kaynaklar

- [GİB e-Fatura mevzuatı ve teknik mimarisi](https://ebelge.gib.gov.tr/efaturamevzuat.html)
- [GİB e-İrsaliye mevzuatı ve teknik mimarisi](https://ebelge.gib.gov.tr/eirsaliyemevzuat.html)
- [Saxonica sürümleri](https://www.saxonica.com/html/products/latest.html)

Kullanılan paketlerin sürüm, kaynak ve dosya özetleri modül kaynak manifestlerinde tutulur. Yeni bir GİB paketi geldiğinde dosyalar ve test örnekleri birlikte güncellenir; çalışma anında kendiliğinden kural güncellemesi yapılmaz.
