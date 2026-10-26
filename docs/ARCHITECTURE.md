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

## Paralel test veritabanları

Aynı geliştirme Postgres'inde şerit için veritabanı açın: `createdb -h 127.0.0.1 -p 5433 -U keystone keystone_test_<serit>`.
Testleri `KEYSTONE_TEST_DB=keystone_test_x vendor/bin/pest` ile çalıştırın (port için `KEYSTONE_TEST_DB_PORT`, varsayılan 5433).
Yalnızca `keystone_test` ve `keystone_test_<a-z0-9>` adları kabul edilir; başka ad testleri durdurur.

## Modül izinleri

Her modül izinlerini kendi `backend/app/Modules/<Ad>/permissions.php` dosyasında bildirir; ortak katalog dosyası düzenlenmez. `PermissionCatalog` ve `DefaultRoles` bu dosyaları `ModuleLoader` gibi otomatik keşfeder.

```php
return [
    'group' => 'sales',                       // GET /permissions çıktısındaki modül anahtarı
    'permissions' => [
        'invoices.view' => ['roles' => ['Admin', 'Sales', 'Accountant']],  // varsayılan rol atamaları
        'invoices.create' => ['roles' => ['Sales']],
        'invoices.delete' => [],                                            // yalnızca Admin
        'companies.delete' => ['super_admin_only' => true],                 // Admin'e bile verilmez
    ],
];
```

- İzin adı `<kaynak>.<eylem>` biçimindedir ve tüm modüller arasında tekil olmalıdır; çakışma testi açık hata verir.
- Geçerli roller: Admin, Accountant, Sales, Purchasing, Warehouse, HR, Viewer; `'*'` tüm varsayılan rolleri kapsar. Admin kataloğun tamamını (super admin'e özel olanlar hariç) zaten alır.
- Yeni izinlerin mevcut şirketlere yansıması için `IdentitySeeder` yeniden çalıştırılır (idempotent).

## Senkron katmanı

Masaüstü istemcinin sunucu tarafı üç parçadır. Tel sözleşmesi [Senkron Protokolü](SYNC-PROTOCOL.md)'ndedir; karar [ADR 0008](adr/0008-sync-module-adapters.md)'dedir.

- **Core sözleşmesi** (`backend/app/Core/Sync/`): `Contracts/SyncResource` (okuma), `Contracts/SyncWriter` (yazma), tel tipleri (`Cursor`, `Xid8`, `Mutation`, `WriteOutcome`, `SyncConflict`), `Schema/Syncable` migration makrosu, `Rules/Uuid7` ve `SyncConfig` (`config/sync.php`). Modüller yalnızca bu sözleşmeye bağlanır.
- **Sync modülü** (`backend/app/Modules/Sync/`): `GET /sync/manifest`, `POST /sync/pull`, `POST /sync/push`, `contracts/offline-manifest.json` okuyucusu, görünürlük nesilleri, tam indirme oturumları ve günlük `sync:prune`. Başka bir modülün modeline dokunmaz.
- **Modül adaptörleri** (`backend/app/Modules/<Ad>/Sync/`): manifest kaynağının sahibi olan modül adaptörü yazar.

### Adaptör deseni

Modül, adaptörlerini kendi servis sağlayıcısında container etiketleriyle kaydeder: `$this->app->tag([...], SyncResource::TAG)` ve `$this->app->tag([...], SyncWriter::TAG)`. Sync modülü bunları `Modules/Sync/Services/Adapters.php` ile manifest kaynak adına göre bulur; etiketler her çağrıda çözülür.

- `SyncResource`: kaynak adı, tablo, kapsam (`SyncScope`), etkin şirketin canlı satırlarını gömülü ilişkileriyle döndüren sorgu (sıralama, limit ve senkron koşulu olmadan), konum ifadesi (`positionColumn`, iki tabloya yayılan kaynakta `GREATEST(...)`), REST ile aynı şekli veren API Resource sınıfı, pencere alanı ve alt kaynaklar için üst kimlik kolonu. Cursor penceresini ve `(sync_txid, id)` keyset'ini pull servisi uygular.
- `SyncWriter`: hedef satırı şirket kapsamında bulur, sürümünü ve taslak durumunu bildirir, mutasyonu modülün kendi REST zinciriyle (FormRequest, Policy, Service) uygular. Doğrulama ve yetki hataları istisna değil `rejected` sonucu olarak döner. Çevrimdışı hiç yazılamayan alanları (`lockedFields`) ve activitylog'un izlediği alanları (`auditFields`) bildirir.
- İstek düzeyi kontroller, idempotency kaydı, mutasyon transaction'ı ve çakışma kararı (sürüm, `draft_only`, alan kümesi) Sync modülündedir. Senkron için ayrı iş kuralı yazılmaz.

Bugün kayıtlı adaptörler: Parties (`PartySyncResource`, `PartySyncWriter`), Catalog ve Reference (yalnız okuma), Sales (`DocumentSyncResource`, `DraftSyncWriter`), Purchasing (`PurchasingSyncResource`, `PurchaseRequestSyncWriter`), Inventory (`StockDocumentSyncResource`, `StockDocumentSyncWriter`).

### Değişiklik izleme, tombstone ve horizon

- Tablo, modülün migration'ında `$table->syncable()` ile bağlanır: `sync_txid xid8` kolonu, index ve `zz_sync_touch` trigger'ı. Alt tablolar `syncable(parent: ..., parentKey: [...])` ile üst satırın konumunu deyim başına bir kez yeniler. Trigger fonksiyonları `backend/database/migrations/2027_08_01_100000_create_sync_functions.php`'dedir.
- Silme ve soft delete `sync_tombstones`'a `(resource_table, row_id)` başına tek satır yazar; restore tombstone'u siler.
- Pull, `pg_snapshot_xmin(pg_current_snapshot())` ile horizon alır ve yalnızca horizon'un altındaki olayları döndürür. Değer küme genelidir: sunucudaki tek bir uzun transaction senkronu geride tutar.
- `sync:prune` 90 günden eski tombstone'ları siler ve `sync_watermarks.floor_txid` tabanını yükseltir. Pull; tabanı, satırları ve tombstone'ları tek bir `REPEATABLE READ` anlık görüntüsünde okur.

### Görünürlük nesli ve tam indirme oturumu

- D1'de satır görünürlüğü kaynak düzeyindedir (manifest `requires`, şirket kapsamı, adaptör sorgusu); satır başına Policy çalışmaz. `Visibility` her manifest ve pull isteğinde `requires` koşulunun durumunu `sync_visibility_generations`'taki durumla karşılaştırır ve değiştiyse nesli artırır. `MembershipRevoked` olayı kullanıcının şirketteki tüm nesillerini artırır.
- Tam indirme oturumu `sync_full_downloads`'ta cihaz (`user_devices`), kullanıcı, şirket ve kaynak başına tek satırdır: opak oturum kimliği, sürüm, başladığı horizon, son ve bir önceki cursor'ın özeti. Her yazma okunan sürüme karşı karşılaştır-ve-değiştirdir; geciken istek daha yeni bir oturumu değiştirmez.

### Satır guard'larında senkron istisnası

Trigger'lar ad sırasıyla çalıştığı için `zz_sync_touch` tablonun kendi `BEFORE UPDATE` guard'larından sonra gelir; guard'ların `to_jsonb(OLD)`/`to_jsonb(NEW)` karşılaştırmaları değişmez. Kesinleşmiş üst satırın her güncellemesini reddeden bir guard ise alt satır yazmasının neden olduğu üst dokunuşunu da reddeder. Bu guard'lar yalnızca konum değişen dokunuşu geçirir:

```sql
IF TG_OP = 'UPDATE' AND sync_touching() AND (to_jsonb(NEW) - 'sync_txid') = (to_jsonb(OLD) - 'sync_txid') THEN
    RETURN NEW;
END IF;
```

`sync_touching()`, üst dokunuşu sırasında açılan `keystone.sync_touch` ayarını okur. Kalıp Sales (`2027_08_01_200400_add_sync_to_sales.php`) ve Purchasing (`2027_08_01_200500_add_sync_to_purchasing.php`) migration'larında kullanılır. `Core/Sync/Contracts/SyncResource.php` ve `Core/Sync/Schema/Syncable.php` doküman yorumları hâlâ daha geniş `IF sync_touching() THEN RETURN NEW; END IF;` biçimini gösterir; yeni guard'larda yukarıdaki dar kalıp kullanılmalıdır.
