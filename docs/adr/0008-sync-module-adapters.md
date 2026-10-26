# ADR 0008: Senkron modülü ve modül adaptörleri

- Durum: Kabul edildi
- Tarih: 2026-10-26

## Bağlam

Senkron sunucusu (`/sync/manifest`, `/sync/pull`, `/sync/push`) Parties, Catalog, Reference, Sales, Purchasing ve Inventory tablolarını okur ve bir kısmına yazar. Modüller arası iletişim yalnızca yayımlanmış sözleşmelerle yürür (ADR 0001); senkron sunucusu bu modüllerin modellerini doğrudan kullanırsa bu sınır kırılır. İş kuralları REST zincirinden ayrı bir senkron yolunda yeniden yazılırsa iki yol birbirinden kayar (ADR 0005).

## Karar

- Senkron sözleşmesi Core'dadır (`backend/app/Core/Sync/`): okuma için `Contracts/SyncResource`, yazma için `Contracts/SyncWriter`, tel tipleri (`Cursor`, `Xid8`, `Mutation`, `WriteOutcome`, `SyncConflict`) ve tabloyu bağlayan `Schema/Syncable` migration makrosu.
- Senkron sunucusu ayrı bir modüldür (`backend/app/Modules/Sync/`). Manifesti, pull ve push akışlarını, görünürlük nesillerini, tam indirme oturumlarını ve `sync:prune` temizliğini sahiplenir; başka bir modülün modeline dokunmaz.
- Manifest kaynağının sahibi olan modül, adaptörünü kendi `Sync/` dizininde yazar ve servis sağlayıcısında `SyncResource::TAG` / `SyncWriter::TAG` etiketiyle kaydeder. Sync modülü adaptörü manifest kaynak adına göre etiketlerden bulur.
- Okuma adaptörü yalnızca etkin şirketin canlı satırlarını, gömülü ilişkileri yüklenmiş olarak ve REST ile aynı API Resource üzerinden verir. Cursor, keyset, horizon, tombstone ve pencere kuralları Sync modülündedir.
- Yazma adaptörü mutasyonu modülün kendi REST zinciriyle (FormRequest, Policy, Service) uygular ve sonucu `WriteOutcome` olarak döner. İstek düzeyi kontroller, idempotency, transaction ve çakışma kararı Sync modülündedir.
- Tablolar kendi modüllerinin migration'larında `syncable()` ile bağlanır. Kesinleşmiş satırları koruyan guard'lar yalnızca `sync_txid` dışında hiçbir kolonu değişmeyen senkron dokunuşunu geçirir (`docs/ARCHITECTURE.md`, "Satır guard'larında senkron istisnası").
- D1'de satır görünürlüğü kaynak düzeyindedir: manifest `requires`, şirket kapsamı ve adaptör sorgusu. Satır başına Policy çalışmaz.

## Sonuçlar

Yeni bir senkron kaynağı, modülün REST ucu ve API Resource'u hazır olduktan sonra bir adaptör, bir `syncable()` migration'ı ve manifest girdisiyle eklenir; Sync modülü değişmez. İş kuralları tek yerde (modül servisinde) kalır; çevrimdışı yazma, REST'in doğrulama ve yetki kontrollerinin hepsinden geçer. Bedeli, her yazma adaptörünün FormRequest'i istek dışında çalıştırmasıdır. Rol ve izin değişiklikleri için Identity henüz olay yayımlamadığından görünürlük nesli, manifest ve pull isteklerinde `requires` durumunun gözlemlenmesiyle artar; yalnız üyelik kaybı (`MembershipRevoked`) nesilleri doğrudan artırır. Ayrıntılar `docs/SYNC-PROTOCOL.md` ve `docs/ARCHITECTURE.md` "Senkron katmanı" bölümündedir.
