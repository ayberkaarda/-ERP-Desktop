# Mühendislik Kuralları

## Modül sınırları

- `Core`, tüm modüllerin kullandığı altyapı ve ortak ilkeleri sağlar; iş alanı davranışı sahiplenmez.
- Her iş alanı kendi `Modules/<Module>` sınırında kalır ve kendi verisinin, kurallarının ve uygulama akışlarının sahibidir.
- Modüller arası erişim yalnızca hedef modülün `Contracts` arayüzleri üzerinden yapılır. Başka modülün modellerini, tablolarını, iç servislerini veya repository'lerini doğrudan kullanmayın.
- Bağımlılık yönü iş alanı modüllerinden `Core` sözleşmelerine doğrudur; modüller birbirinin iç katmanına bağlanmaz.

## PHP ve API

- PHP dosyalarının başında `declare(strict_types=1);` kullanın.
- Sabit iş durumu ve seçenekleri için string veya integer sabitleri yerine enum kullanın.
- Katman sınırlarında açık, doğrulanabilir DTO'lar kullanın; istekleri ve yanıtları ham dizi olarak taşımayın.
- Tüm API yolları `/api/v1` önekiyle sürümlenir.
- Başarılı yanıt biçimi `{"data": ..., "meta": {...}}`; hata biçimi `{"errors": {"message": ..., "code": ..., "fields": ...}}` şeklindedir. `fields` isteğe bağlıdır.

## Veri ve eşzamanlılık

- Kimlikler UUIDv7 olmalıdır; sıralanabilirlik ve zaman bilgisini kimlik üretiminde koruyun.
- Para değerlerini kayan nokta ile değil, veritabanında `numeric` türüyle saklayın. Hassasiyet ve ölçek alan tanımında açık olmalıdır.
- Eşzamanlı güncellemelerde `version` sütununu kullanın. İstemcinin sürümü güncel değilse HTTP 409 döndürün.
- Tekrarlanması güvenli olmayan yazma isteklerinde `Idempotency-Key` başlığını destekleyin ve anahtarı kapsamı ile birlikte saklayın.
- Şirkete ait her kaydı `company_id` ile kapsamlandırın. Okuma, yazma, ilişki ve arka plan işlerinde şirket kapsamını doğrulayın.

## Değişiklik ilkeleri

- Alan kurallarını HTTP, veritabanı veya arayüz ayrıntılarından bağımsız tutun.
- Şema değişikliklerini migration ile, dış API değişikliklerini sürüm ve OpenAPI tanımıyla yönetin.
- Mimari yönü etkileyen seçimleri `docs/adr/` altında kaydedin.
