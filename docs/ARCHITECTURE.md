# Mimari

Keystone ERP, tek dağıtım birimi içinde modüllere ayrılmış bir monolittir. Bu yaklaşım işlem bütünlüğünü ve yerel geliştirme akışını korurken iş alanlarının açık sınırlarla evrilmesini sağlar.

## Katmanlar

- **Core:** Kimlik, şirket kapsamı, ortak sözleşmeler ve platform altyapısı gibi modüller arası temel yetenekleri sunar.
- **Modules:** Her modül kendi iş kurallarını ve verisini sahiplenir. Modüller arası iletişim yalnızca yayımlanmış `Contracts` üzerinden yürür.
- **API:** `/api/v1` altında sürümlü HTTP arayüzü sağlar. Başarılar `data` zarfı, hatalar `errors` zarfı kullanır.
- **Frontend:** API sözleşmesine bağlı web istemcisidir; türleri üretilen OpenAPI tanımından alınır.
- **Üretilen artefaktlar:** `backend/storage/api-docs/openapi.json` ve `frontend/src/lib/api/schema.d.ts` depoya commit edilmez, üretilir. Yerelde backend `composer install-windows` (veya `composer install`) sonrası kökte `npm run gen:api` çalıştırılır; CI aynı adımı lint/typecheck/test/build öncesinde yürütür.

## Veri ilkeleri

Kimlikler UUIDv7 kullanır. Para alanları kayan nokta türü yerine `numeric` olarak saklanır. Değiştirilebilir kayıtlar iyimser eşzamanlılık için `version` taşır; sürüm uyuşmazlığı 409 yanıtı üretir. Tekrarlanabilir yazma işlemleri `Idempotency-Key` ile güvence altına alınır. Şirkete ait veri `company_id` üzerinden kapsamlandırılır.

## Kararlar

Dağıtım biçimi ve veri kimliği kararları `docs/adr/` altında kayıtlıdır. Uygulama sınırları için [Mühendislik Kuralları](ENGINEERING-RULES.md) geçerlidir.
