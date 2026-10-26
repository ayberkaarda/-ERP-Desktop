# ADR 0005: Senkron push sonuçları ve çakışma kuralları

- Durum: Kabul edildi
- Tarih: 2026-10-26

## Bağlam

Masaüstü istemci çevrimdışıyken taslak oluşturur ve düzenler; değişiklikler bir outbox'ta birikir. Bağlantı gelince bu değişiklikler, aynı kayıtlar web'de değişmiş olsa bile tutarlı biçimde uygulanmalıdır. İş kuralları iki yerde yazılırsa birbirinden kayar.

## Karar

`POST /api/v1/sync/push` partilenmiş mutasyonları sırayla, her birini kendi transaction'ında, ilgili REST ucunun FormRequest → Policy → Service zincirinden geçirerek uygular. Parti atomik değildir.

- İstemcinin ürettiği UUIDv7 sunucuda doğrudan birincil anahtar olur.
- Her mutasyon kendi `idempotency_key`'ini taşır; anahtar (kullanıcı, şirket, `sync.push`) kapsamıyla 7 gün saklanır.
- Sonuç dört değerden biridir: `applied`, `duplicate`, `conflict`, `rejected`.
- Sessiz üzerine yazma yasaktır:
  1. Taslak olmayan belgeye yazma `conflict` / `DOCUMENT_LOCKED` olur; kullanıcı yeni taslak olarak kaydeder ya da vazgeçer.
  2. `base_version` eskiyse `changed_fields`, o sürümden beri değişen alanlarla karşılaştırılır. Kesişim yoksa uygulanır (`merged_fields`).
  3. Kesişim varsa `conflict` / `VERSION_CONFLICT`; kullanıcı Conflict Inbox'ta KeepMine, TakeServer veya Merge seçer.
  4. Aradaki değişikliği kesin bilinemeyen alan kesişiyor sayılır.
  5. Yeni cari, mükerrer adayı varsa `conflict` / `DUPLICATE_RECORD` olur.
- Aynı partide aynı kaydın önceki mutasyonu başarısızsa sonrakiler `rejected` / `SYNC_DEPENDENCY_FAILED` olur.
- Numara verme, kesinleştirme ve stok etkisi push kapsamında değildir; bunlar ONLINE_ONLY'dir (ADR 0006).

## Sonuçlar

İş kuralları yalnızca sunucu servislerinde yaşar. İstemci her sonucu deterministik olarak işler: uygulananı yerelde günceller, çakışanı kullanıcıya bırakır, reddedileni hata koduyla gösterir. `ErrorCode`'a `DOCUMENT_LOCKED`, `DUPLICATE_RECORD` ve `SYNC_` önekli kodlar eklenir. Alan bazlı birleştirmenin kalitesi audit kaydının hangi alanları sürüm bazında tuttuğuna bağlıdır.
