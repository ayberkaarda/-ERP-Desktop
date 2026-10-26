# ADR 0005: Senkron push sonuçları ve çakışma kuralları

- Durum: Kabul edildi
- Tarih: 2026-10-26

## Bağlam

Masaüstü istemci çevrimdışıyken taslak oluşturur ve düzenler; değişiklikler bir outbox'ta birikir. Bağlantı gelince bu değişiklikler, aynı kayıtlar web'de değişmiş olsa bile tutarlı biçimde uygulanmalıdır. İş kuralları iki yerde yazılırsa birbirinden kayar.

## Karar

`POST /api/v1/sync/push` partilenmiş mutasyonları sırayla, her birini kendi transaction'ında, ilgili REST ucunun FormRequest → Policy → Service zincirinden geçirerek uygular. Parti atomik değildir.

- İstemcinin ürettiği UUIDv7 sunucuda doğrudan birincil anahtar olur.
- Her mutasyon kendi `idempotency_key`'ini taşır; anahtar (kullanıcı, şirket, `sync.push`) kapsamıyla, istek özeti ve sonucun tamamıyla 7 gün saklanır. Tekrar gönderimde saklanan sonuç döner: `applied` ise `duplicate`, `conflict`/`rejected` ise aynı statü ve gövde (`replayed: true`).
- Sonuç dört değerden biridir: `applied`, `duplicate`, `conflict`, `rejected`.
- `changed_fields`, payload'ın üst düzey anahtar kümesine eşit olmak zorundadır; sunucu doğrular ve yalnızca bu kümeyi uygular. Payload `version` taşımaz; sunucu REST `version` parametresini satır kilidi altında kendisi üretir.
- Sürüm kontrolü işlem bazındadır: `update` alan bazlı birleştirir, `delete` ve `action` (ör. sayım girişi) sunucu sürümüne kesin eşitlik ister. Sunucudan büyük `base_version` her zaman reddedilir.
- Hedef kayıt kısıtları (`target_constraints`, ör. yalnızca `doc_type = count` stok belgesi) payload kısıtlarından ayrı olarak, kilit altında hedef satır üzerinde denetlenir.
- Sessiz üzerine yazma yasaktır:
  1. Taslak olmayan belgeye yazma `conflict` / `DOCUMENT_LOCKED` olur; kullanıcı yeni taslak olarak kaydeder ya da vazgeçer.
  2. `base_version` eskiyse `changed_fields`, o sürümden beri değişen alanlarla karşılaştırılır. Kesişim yoksa uygulanır (`merged_fields`).
  3. Kesişim varsa `conflict` / `VERSION_CONFLICT`; kullanıcı Conflict Inbox'ta KeepMine, TakeServer veya Merge seçer.
  4. Aradaki değişikliği kesin bilinemeyen alan kesişiyor sayılır.
  5. Yeni cari, mükerrer adayı varsa `conflict` / `DUPLICATE_RECORD` olur.
- Conflict Inbox kararları, yeni anahtarlı ve çözdüğü conflict'i `resolution` ile adresleyen yeni mutasyonlardır; mükerrer caride `keep_mine` mükerrer kontrolünü yalnızca bu yolla atlar.
- Aynı kaydın önceki mutasyonu ya da `depends_on` ile bildirilen (yalnızca geriye bakan) mutasyon başarısızsa sonraki `rejected` / `SYNC_DEPENDENCY_FAILED` olur.
- Numara verme, kesinleştirme ve stok etkisi push kapsamında değildir; bunlar ONLINE_ONLY'dir (ADR 0006).

## Sonuçlar

İş kuralları yalnızca sunucu servislerinde yaşar. İstemci her sonucu deterministik olarak işler: uygulananı yerelde günceller, çakışanı kullanıcıya bırakır, reddedileni hata koduyla gösterir. `ErrorCode`'a `DOCUMENT_LOCKED`, `DUPLICATE_RECORD` ve `SYNC_` önekli kodlar eklenir. Alan bazlı birleştirmenin kalitesi audit kaydının hangi alanları sürüm bazında tuttuğuna bağlıdır.
