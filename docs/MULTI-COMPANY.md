# Çok şirketli erişim — Faz 1

## Veri ve model kapsamı

- Her iş tablosunda `company_id` bulunur. Firma kapsamındaki kayıtların sorgu ve yazma işlemleri şirket bağlamına göre sınırlandırılır.
- Firma kapsamlı Eloquent modelleri `BelongsToCompany` trait'ini kullanır. Trait'in global scope'u `CompanyContext::idOrNull()` değerini `company_id` ile eşleştirir; oluşturma kancası `company_id` değerini bağlamdan atar.
- `CompanyContext` istek/iş boyunca scoped singleton'dır. `set(string $companyId)`, `id()` (bağlam yoksa hata verir), `idOrNull()` ve `runAs(string $companyId, Closure $fn)` arayüzlerini sağlar.
- Kapsamı atlamak gereken kontrollü sorgular modelin `scopeWithoutCompanyScope` yöntemini kullanır; bu kullanım sıradan şirket kullanıcılarına açılmaz.

## İstek bağlamı ve üyelik denetimi

Şirket kapsamlı API uçları `/api/v1` altındadır ve `X-Company-Id` başlığı ister. `company` middleware sırasıyla:

1. Başlıktaki şirket kimliğini okur; yoksa `400 COMPANY_REQUIRED` döner.
2. Kimliği doğrulanmış kullanıcının `MembershipChecker::isMember(userId, companyId)` üyeliğini denetler; üyelik yoksa `403 COMPANY_FORBIDDEN` döner.
3. `CompanyContext` değerini ayarlar ve Spatie Permission teams için etkin team id'yi şirket kimliğine ayarlar.
4. İsteği devam ettirir; global scope sorguları bu bağlamla filtreler.

İstemci, seçili şirketin kimliğini her şirket kapsamlı istekte `X-Company-Id` başlığına ekler. Kimlik doğrulama ve şirket kapsamı gerektirmeyen uçlar şirket başlığına bağlı değildir.

## İzinler, roller ve istisnalar

- Spatie Permission, teams özelliğini kullanır; etkin team şirkettir. Roller şirket başına tanımlanır, kullanıcı-rol ataması da `company_id` ile yapılır. Böylece aynı kullanıcı farklı şirketlerde farklı rollere sahip olabilir.
- İzin adları `<resource>.<action>` biçimindedir; temel eylemler `view`, `create`, `update`, `delete`, gerektiğinde alan fiilleridir. Rol/izin denetimi seçili şirketin team bağlamında yapılır.
- `users.is_super_admin` için identity tarafından tanımlanan `Gate::before` tüm yetki denetimlerini aşar. Bu ayrıcalık üyelik modelini veya şirket verisi kapsamını değiştirmez; sorgular yine şirket bağlamında tutulur.
- Şirket oluşturma yalnızca super admin'e açıktır. Diğer şirket işlemleri ve kaynaklar ilgili izinlere ve gerektiğinde üyeliğe tabidir.

## Şirket seçici davranışı

- `GET /auth/me`, kullanıcının şirketlerini `{id,name,role_names}` ve şirket kimliğine göre izin haritalarını döner.
- İstemci bu listeden etkin şirketi seçer ve tüm şirket kapsamlı isteklerde başlığa ekler. Seçim değişince şirket deposundaki etkin şirket güncellenir; sonraki sorgular yeni `X-Company-Id` ile yapılır.
- Yetki arayüzü, etkin şirketin izinlerini kullanır. Üyeliği olmayan bir kimlik elle gönderilse bile middleware erişimi reddeder. Şirket değiştirme kimlik doğrulamasını yenilemez; etkin team ve şirket bağlamını yeni istekte değiştirir.

## Arka plan işleri

Kuyruğa alınan şirket işi şirket kimliğini açıkça taşır. İş, kapsamlı sorgulardan önce `CompanyContext::runAs($companyId, fn () => ...)` içinde çalışır; callback süresince global scope ve Spatie team bağlamı o şirkete ayarlanır. İşlem sonunda bağlam temizlenir ve sonraki işe sızmaz. İstek dışından bağlamı örtük olarak devralmaya güvenilmez.

## Yeni şirket kapsamlı model kontrol listesi

- [ ] Tabloya `company_id` ekle; nullable olmasını gerektiren açık bir neden yoksa zorunlu tut.
- [ ] `company_id` için uygun yabancı anahtar/indeks tanımla; diğer iş tablolarında UUIDv7 PK kullan.
- [ ] Modelde `BelongsToCompany` kullan; şirket kapsamı dışı sorguları yalnızca gerekçeli ve kontrollü `scopeWithoutCompanyScope` ile yaz.
- [ ] Oluşturma ve güncelleme akışının şirket kimliğini istemci gövdesinden güvenmeden, `CompanyContext` üzerinden aldığını doğrula.
- [ ] Uç noktanın kimlik doğrulama ve `company` middleware zincirinde olduğunu, başlık ve üyelik denetiminin yapıldığını doğrula.
- [ ] İzin adlarını `<resource>.<action>` biçiminde tanımla ve rolleri etkin şirket team'inde denetle.
- [ ] İş/olay/iş kuyruğu şirket kimliğini taşır; arka plan sorgularını `CompanyContext::runAs` içinde çalıştır.
- [ ] Listeleme, tekil okuma, güncelleme ve silme akışlarında başka şirketin kaydına erişilemediğini kontrol et.