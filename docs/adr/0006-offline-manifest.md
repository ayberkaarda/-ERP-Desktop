# ADR 0006: Çevrimdışı kapsam manifesti

- Durum: Kabul edildi
- Tarih: 2026-10-26

## Bağlam

Hangi verinin çevrimdışı okunabileceği ve hangi işlemlerin çevrimdışı yapılabileceği hem sunucunun hem Rust sync motorunun hem de arayüzün bildiği tek bir kaynaktan gelmelidir. Bu bilgi koda dağılırsa sunucunun kabul ettiğiyle istemcinin sunduğu ayrışır.

## Karar

Kapsam `contracts/offline-manifest.json` dosyasında, `contracts/offline-manifest.schema.json` şemasıyla tanımlanır.

- Her kaynak gerçek bir REST route'una, API Resource sınıfına ve modülün izin adlarına bağlanır. Kaynak adı route yolundan türetilir.
- Okuma modu `local-first`, `online-first` veya `offline-fallback`'tir; kaynak `pull` ya da `snapshot` ile beslenir.
- Yazma yalnızca `draft-outbox` modundadır ve işlem bazında route ile izin listeler; `draft_only` ve `payload_constraints` ile sınırlanır.
- Varsayılan kural reddir: `write` tanımı olmayan her mutasyon ONLINE_ONLY'dir. `online_only` listesi, arayüzde devre dışı gösterilecek işlemleri gerçek route'larıyla ve `desktop.onlineOnly.<action>` anahtarıyla tanımlar.
- `GET /api/v1/sync/manifest`, bu dosyayı kullanıcının izinleriyle süzerek döner.

## Sonuçlar

Çevrimdışı kapsamı genişletmek bir dosya değişikliği ve `manifest_version` artışıdır. Manifestteki route'lar backend'de bulunmak zorundadır; bu, CI'da route listesine karşı denetlenir. Numara, risk limiti, stok rezervasyonu ve defter bütünlüğü sunucuda kalır.
