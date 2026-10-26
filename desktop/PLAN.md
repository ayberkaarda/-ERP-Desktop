# Keystone ERP — Masaüstü Planı (`C:\dev\-ERP-Desktop`)

> Web tamamlandıktan sonra uygulanır. D0'da bu dosya `desktop/PLAN.md` olarak taşınır, ardından web reposu `upstream` olarak merge edilir.

## Context

Kullanıcı Türkiye öncelikli, çok şirketli, **tam kapsamlı** ve mühendislik seviyesinde bir ERP istiyor. Önce web (`C:\dev\-ERP`), ardından Syncra-CRM-Desktop'taki gibi ayrı repoda bir masaüstü uygulaması (`C:\dev\-ERP-Desktop`).

İçinde LLM bağlanabilen bir asistan katmanı hazır olacak ama **varsayılan kapalı** gelecek. Biz LLM bağlamıyoruz; isteyen `.env`'e sağlayıcı ve API anahtarı yazıp açar.

Tech stack, kullanıcının repolarıyla aynı aileden olacak: `ayberkaarda/Syncra-CRM` (yerelde `C:\dev\SIGMA-CRM`, Laravel + React) ve `Syncra-CRM-Desktop` (yerelde `C:\dev\SIGMA-CRM-Desktop`, Tauri 2 + Rust).

**Korunacak CRM güçlü yanları:**
- tek hata zarfı
- her uçta Policy ve IDOR kontrolleri
- row lock + `version` ile eşzamanlılık
- broadcast'in commit sonrası yapılması
- güvenlik test seti
- Türkçe dokümantasyon disiplini
- masaüstünde SQLCipher, outbox ve Conflict Inbox, "sessiz üzerine yazma yasak" ilkesi, üç dilde wire-fixture sözleşme testleri

**Kapatılacak CRM açıkları:**
- *Altyapı:* CI ve Docker yok, Windows/XAMPP bağımlılığı var.
- *Backend kalitesi:* statik analiz, strict_types, Enum ve DTO yok. API versiyonsuz, OpenAPI yok.
- *Frontend:* test, form ve schema kütüphanesi yok. Kod tekrarı ve yorum gürültüsü fazla.
- *Ürün:* çok şirket desteği yok.
- *Masaüstü:*
  - Masaüstü reposu web reposunun **kopyası** ve ayrışmış durumda: frontend'de 89, backend'de 55 dosya farklı. Sync API yalnızca bu kopyada var.
  - Senkron her yazmayı tek bir global sayaç satırında sıraya sokuyor.
  - Token webview JS'ine açık.
  - Sunucu adresi ve Reverb anahtarı derleme anında gömülü.
  - 22 elle kopyalanmış mirror tablo var.
  - Tipler elle yazılıp regex script'leriyle kontrol ediliyor.

**Kullanıcı kararları:**
- güncel sürümler (PHP 8.4 / Laravel 13 / React 19)
- PostgreSQL 18
- Türkiye öncelikli yerelleştirme
- çok şirketli tek kurulum (kapalı devre, public kayıt yok)
- masaüstü **ayrı repo** (CRM gibi)
- çevrimdışı kapsam: **okuma + taslak**
- isim: **Keystone**, yani kemerin ortasındaki kilit taşı; işletmeyi bir arada tutan parça. Kimlikler: `APP_NAME=Keystone`, DB `keystone`, `com.keystone.desktop`, deep-link `keystone://`, Rust crate `keystone-sync`. İsim tek config noktasından yönetilir.

---

# Web tarafının özeti

Ayrıntılı plan: `C:\dev\-ERP\plan.md`. Web reposu bu reponun `upstream`'idir.

**Stack:**
- Backend: PHP 8.4, Laravel 13 (modüler monolit), Sanctum 4 (SPA cookie + cihaz token'ı + TOTP 2FA), spatie permission 8 (teams = şirket), activitylog 5, Reverb, Redis 8 + Horizon.
- Veritabanı ve para: PostgreSQL 18, brick/money.
- Asistan: laravel/ai, varsayılan kapalı.
- Frontend: React 19.3, Vite 8, TypeScript 6.0, React Router 8, TanStack Query 5, Zustand 5, Tailwind 4.3, shadcn/ui (Radix), react-hook-form + zod, TanStack Table, i18next (tr/en/de/fr).
- Test: Pest 5, Larastan, Vitest, Playwright.

**Bağlayıcı değişmezler:** float yok, çift taraflı defter, append-only stok defteri, belge durum makinesi, boşluksuz numaralandırma, `version` ile optimistic lock, `Idempotency-Key`, UUIDv7 PK, `company_id` izolasyonu.

API yanıt sözleşmesi CRM ile aynıdır: `{data, meta}` / `{errors:{message, code, fields}}`, `/api/v1` altında, OpenAPI'den üretilmiş tiplerle.

Masaüstünün dayandığı ve web fazlarında hazırlanan zemin:

## Web'de hazırlanan zemin (A6)

CRM'de masaüstü için backend'de 55, frontend'de 89 dosya sonradan değişti. Keystone'da bu zemin baştan web reposuna konur:

- **Kimlik ve eşzamanlılık:** UUIDv7 PK (istemci üretebilir), `version` kolonu, `Idempotency-Key`. Bunlar zaten A3'te var.
- **Syncable makrosu:** `$table->syncable()` migration makrosu senkronlanabilir tablolara `sync_txid xid8` kolonu, index ve `BEFORE INSERT/UPDATE` trigger'ı (`pg_current_xact_id()`) ekler. Silmeler için `sync_tombstones` trigger'ı. Kapsam: ana veriler ve taslaklanabilir belgeler.
- **Token auth:** Sanctum token guard'ı (`abilities`, süre sonu) web fazında test edilir. Device-login ucu masaüstü fazında eklenir.
- **Frontend platform arayüzü:** `frontend/src/platform/` altında `http`, `realtime`, `connectivity`, `notify`, `files` (kaydet/yazdır/aç) tanımlanır, şimdilik yalnızca web adaptörüyle.
  - Feature'lar ağa **yalnızca `platform.http` üzerinden** çıkar. Bunu bir ESLint kuralı zorlar: feature içinde axios veya fetch import'u yasak.
- **Standart query key'ler:** `[resource, …]` formatında. Böylece masaüstü invalidation'ı jenerik olur, CRM'deki elle yazılmış eşleme tablosu gerekmez.

---

# BÖLÜM B — MASAÜSTÜ (`C:\dev\-ERP-Desktop`, web bittikten sonra)

## B1. Repo stratejisi: ayrı repo, ama kopmayan

- **Başlangıç:** `-ERP-Desktop` reposu web reposunun **git geçmişiyle birlikte** forku olarak başlar. CRM'deki gibi geçmişsiz anlık kopya olmaz.
  - `upstream` remote'u = web reposu. Web değişiklikleri düzenli `git merge upstream/main` ile alınır.
  - D0'da önce mevcut `plan.md` → `desktop/PLAN.md` olarak taşınır, sonra merge yapılır (kökteki `plan.md` ile çakışmasın diye).
- **Upstream-first kuralı:** masaüstü reposu `backend/`, `frontend/`, `contracts/` klasörlerini **değiştirmez**. Gerekli değişiklik önce web reposuna yapılır, sonra merge edilir.
  - CI'da **drift guard** job'ı: `git diff upstream/main -- backend frontend contracts` boş olmalı.
  - Sync sunucu modülü de web reposunda yaşar. Böylece production backend masaüstü istemcilerine hizmet verir; CRM'de bu yalnızca kopyada vardı.
- **Yapı** (CRM-Desktop ile aynı):

  ```
  backend/ frontend/ contracts/   ← upstream'den aynen gelir
  desktop/
    crates/keystone-sync/          sync motoru kütüphanesi (UI'sız, #![forbid(unsafe_code)])
    src-tauri/                     ince Tauri kabuğu (commands, capabilities, tauri.conf.json)
    src/                           masaüstüne özel TS: platform/desktop, bridge, ui/panels
    scripts/
  package.json                     npm workspaces [frontend, desktop]
  ```

  Tek `node_modules` olduğu için CRM'deki `dedupe` hilesi gerekmez; `desktop/src` de react-query, i18next ve lucide kullanabilir.

## B2. Masaüstü stack

| Bileşen | Seçim |
|---|---|
| Kabuk | **Tauri 2.12** (Tauri 3 alpha'da, kullanılmaz). Pluginler: single-instance, updater, window-state, notification, global-shortcut, deep-link, autostart, dialog, fs (kapsamlı), os, process, shell (yalnızca http/https), log (PII maskeli). |
| Rust | Toolchain `rust-toolchain.toml` ile sabitlenir (1.98). Edition 2024. |
| Rust bağımlılıkları | rusqlite 0.40 (`bundled-sqlcipher-vendored-openssl`), tokio 1, reqwest 0.13 (rustls), tokio-tungstenite 0.30 (Reverb), serde, uuid (v7), thiserror 2, keyring 4, tracing + tracing-subscriber, chrono. Dev: wiremock, tempfile. |
| Tipler | **ts-rs** (kararlı) ile Rust → TS IPC tipleri üretilir. tauri-specta 2 hâlâ RC; kararlıya çıkınca ADR ile değerlendirilir. Sync wire **JSON Schema**'dan (`contracts/sync`) üretilir: Rust için `typify`, TS için `json-schema-to-typescript`. PHP tarafı testlerde schema'ya karşı doğrular. |
| Frontend | Web'in `frontend/src`'i aynen + `platform/desktop` adaptörü. |

## B3. Çevrimdışı kapsam (onaylanan: okuma + taslak)

- **Çevrimdışı okunur:**
  - Ana veriler: cari, stok kartı, fiyat listesi, depo, vergi kodu, kur, birim, vade.
  - Son belgeler (pencere: 30 gün).
  - Stok ve cari bakiyeleri, "şu tarih itibarıyla" etiketli anlık görüntü olarak.
- **Çevrimdışı yazılır (outbox):** satış teklifi/sipariş taslağı, satınalma talebi, sayım girişi, masraf beyanı, izin talebi, puantaj ve zaman çizelgesi, not ve aktivite, yeni cari taslağı. Yeni cari sunucuda mükerrer kontrolünden geçer; çakışırsa Conflict Inbox'a düşer.
- **Yalnızca çevrimiçi** (`ONLINE_ONLY`): kesinleştirme, onay, ödeme/tahsilat, numara verme, stok düşümü, e-Fatura gönderimi, bordro ve MRP çalıştırma, dönem kapanışı, canlı raporlar.
  - Butonlar devre dışı görünür ve `desktop.onlineOnly.<action>` tooltip'i gösterir (CRM deseni).
  - Gerekçe: boşluksuz numara, risk limiti, stok rezervasyonu ve defter bütünlüğü sunucuda kalmalı.
- **Kapsam tanımı:** hangi uçların ne yapabildiği `contracts/offline-manifest.json` dosyasında tanımlanır (`read: local-first | online-first | offline-fallback`, `write: draft-outbox`). Hem sunucu hem Rust bu dosyayı okur.

## B4. Senkron mimarisi (sunucu tarafı web reposunda, `Modules/Sync`)

- **Değişiklik akışı, global kilit olmadan:** CRM'deki tek sayaç satırı (her yazmayı sıraya sokuyordu) yerine **xid watermark** kullanılır.
  - A6 trigger'ı her satıra `sync_txid = pg_current_xact_id()` yazar.
  - Pull, `horizon = pg_snapshot_xmin(pg_current_snapshot())` alır ve `sync_txid >= cursor AND sync_txid < horizon` satırlarını `(sync_txid, id)` keyset sayfalamasıyla döner.
  - Horizon'un altındaki tüm transaction'lar bittiği için satır atlanmaz. Web yazmaları da yavaşlamaz.
  - Uzun transaction'lar yalnızca senkronu geciktirir; bu durum izlenir.
- **Uçlar:**

  | Uç | İçerik |
  |---|---|
  | `GET /api/v1/sync/manifest` | Kullanıcının görebildiği kaynaklar (izin filtreli), etkin izinler, sunucu limitleri, şema sürümü. |
  | `POST /api/v1/sync/pull` | Kaynak başına cursor; satırlar **REST API Resource'larıyla aynı JSON şeklinde** döner (tek doğruluk kaynağı). Ayrıca tombstone'lar, `next_cursor` ve `has_more`. |
  | `POST /api/v1/sync/push` | Partilenmiş mutasyonlar: `{idempotency_key, op, resource, id(UUIDv7), base_version, changed_fields, occurred_at, payload}`. |

  CRM K7 korunur: push, mevcut FormRequest → Policy → Service zincirinden geçirilir. Sonuçlar: `applied | duplicate | conflict | rejected(code)`.
- **Kimlikler:** istemcinin ürettiği UUIDv7 doğrudan sunucu PK'si olur. CRM'deki `client_id`/`server_id` ikiliği ve `uuid5` türetmesi kalkar.
- **Çakışma kuralları** (sessiz üzerine yazma yasak):
  1. Belge artık taslak değilse `DOCUMENT_LOCKED` döner; kullanıcı "yeni taslak olarak kaydet" veya "vazgeç" seçer.
  2. `base_version` eskiyse, değişen alanlar o sürümden beri değişenlerle (audit diff) karşılaştırılır. Kesişim yoksa uygulanır.
  3. Kesişim varsa Conflict Inbox'a düşer: KeepMine / TakeServer / Merge.
- **Cihaz kimliği:**
  - `POST /api/v1/auth/device` 2FA'yı destekler ve `desktop` yetenekli bir Sanctum token verir.
  - Erişim token'ı kısa ömürlüdür, refresh token döndürülerek yenilenir. Token cihaza bağlıdır.
  - `GET/DELETE /me/devices` ile cihazlar listelenip iptal edilir. Pasifleştirme, şifre değişimi ve admin reset token'ı iptal eder.
- **Saklama:** tombstone 90 gün, idempotency 7 gün. Görünürlük değişince (izin kaybı vb.) ilgili kaynak yeniden indirilir.

## B5. Rust/Tauri mimarisi

- **Tek bir taşıma katmanı (en önemli fark):** webview **ağa hiç çıkmaz**.
  - `platform.http` bir `api_request` komutuyla Rust'a gider. Rust yalnızca `/api/v1/` öneki için izin verir.
  - **Çevrimiçiyken** istek bearer token ile sunucuya iletilir.
  - **Çevrimdışıyken** manifest'teki GET uçları yerel mirror'dan, taslak POST/PATCH uçları outbox'tan cevaplanır. Geri kalan her şey `OFFLINE_UNAVAILABLE` döner.
  - Sonuç: feature kodu web ile birebir aynı kalır. CRM'deki 138 metotluk `platform.data` katmanı ve feature dosyalarındaki değişiklikler gerekmez.
- **Güvenlik kazanımları:**
  - Token webview'e hiç gelmez.
  - CSP `connect-src ipc: http://ipc.localhost` ile sınırlıdır.
  - Ekler `keystone-asset://` özel protokolüyle Rust cache'inden servis edilir.
- **Sunucu profilleri (çalışma anında):** ilk açılışta sunucu URL'si girilir. `GET /api/v1/meta` ad, sürüm, Reverb host ve anahtarı, minimum masaüstü sürümü ve güncelleme kanalını döner. Birden fazla profil (test/prod) desteklenir. Bu, derleme anına gömme sorununu ve CRM açıkları O111/O112'yi çözer.
- **Yerel depo:**
  - SQLCipher, WAL, FTS5 (`unicode61 remove_diacritics 2` + Türkçe İ/ı katlama, CRM'den port).
  - Anahtar OS keychain'de. Migration'lar `user_version` ile yönetilir.
  - **Jenerik mirror:** kaynak başına bir tablo; `data` sütunu API Resource JSON'u tutar. Manifest'te tanımlı filtre ve sıralama alanları `GENERATED ... json_extract` kolonları ve index'lerle sağlanır. 22 elle kopyalanmış tablo gerekmez.
  - Bağlantılar: tek yazar + küçük okuyucu havuzu.
  - Outbox: açık `depends_on` kenarları (CRM'deki `LIKE '%client_id%'` yerine), birleştirme kuralları (create+update → create, create+delete → iptal).
- **Senkron döngüsü** (CRM deseni korunur): push → pull. Tetikleyiciler:
  - açılış
  - çevrimiçiyken 60 sn'lik zamanlayıcı
  - çevrimdışıyken 1/2/4/8/16/30 sn aralıklarla sunucu yoklaması
  - **OS ağ değişikliği olayı** (CRM'de yoktu)
  - manuel tetik
  - realtime olay
  - Hata halinde backoff 1 sn'den 300 sn'ye ±%20 jitter ile. Saklama varsayılanları: 30 gün / 500 MB / 5000 yazma.
- **Realtime:**
  - Rust içinde Pusher protokolü istemcisi (tokio-tungstenite) Reverb'e bağlanır. Kanal yetkisi bearer token ile alınır.
  - Gelen olay ilgili kaynağın pull'unu tetikler. Ardından `ResourcesChanged` yayınlanır ve `[resource, …]` query key'leriyle jenerik invalidation yapılır.
- **Hata modeli:** `thiserror` enum'u → `CommandError {code, message, retry_after?}`. Kodlar OpenAPI'deki `ErrorCode` ile aynıdır ve UI'da `desktop.errors.<code>` ile çevrilir.
- **Kimlik kaybı** (CRM deseni):
  - 401: outbox korunur; aynı kullanıcı tekrar girerse senkron devam eder, farklı kullanıcı girerse yerel veri silinir.
  - 403 `USER_DEACTIVATED`: yerel veri, cache ve keychain tamamen silinir.
  - Bekleyen iş varken çıkış `force` ister.

## B6. OS entegrasyonu

- **Tepsi:** kapatınca tepsiye küçülür.
- **Bildirimler:** onay bekleyen belgeler için yerel bildirim ve rozet.
- **Hızlı yakalama:** `CmdOrCtrl+Shift+Space` → hızlı masraf, stok veya barkod sorgu, not.
- **Deep link:** `keystone://<resource>/<uuid>`, izin listesi + doğrulama, fuzz testli.
- **Pencere ve başlangıç:** single-instance, window-state, opsiyonel autostart.
- **Yazdırma:** fatura, irsaliye ve bordro PDF'leri yerel cache'ten açılır ve yazdırılır.
- **Dosya ve barkod:** sürükle-bırak ek. Klavye-wedge barkod okuyucu doğal olarak çalışır; seri port okuyucu opsiyoneldir.

## B7. Masaüstü fazları

| Faz | Teslimat |
|---|---|
| **D0 — Repo & sözleşmeler** | Geçmişli fork + upstream + drift guard. `docs/SYNC-PROTOCOL.md`, ADR'ler, `contracts/sync/*.schema.json`, `offline-manifest.json` (**web reposuna** yazılıp merge edilir). |
| **D1 — Sunucu Sync modülü** (web reposunda) | Device auth + refresh, `meta`, `manifest`/`pull`/`push`, tombstone, idempotency, çakışma kuralları, PHP wire-fixture testleri. |
| **D2 — `keystone-sync` crate** | SQLCipher depo, jenerik mirror, outbox, push/pull, backoff, saklama, çakışmalar. wiremock entegrasyon testleri + Rust wire-fixture testleri. |
| **D3 — Tauri kabuğu** | `api_request` taşıma katmanı + çevrimdışı yönlendirici, keychain, sunucu profilleri, Rust Reverb istemcisi, CSP kilidi, ts-rs tipleri. |
| **D4 — Frontend entegrasyonu** | `platform/desktop` adaptörü, senkron durum rozeti, bekleyen/çakışma rozetleri, Conflict Inbox, online-only UX, `desktop` i18n namespace'i, TS wire-fixture testleri. |
| **D5 — OS entegrasyonu** | B6. |
| **D6 — Release & sertleştirme** | CI matrisi (Windows/Ubuntu/macOS), tauri-action, updater (şifreli minisign anahtarı, profil bazlı güncelleme kanalı), tehdit modeli, tauri-driver e2e, bellek ve açılış ölçümü, ilk `desktop-v0.1.0`. |

## B8. Masaüstü doğrulama

- **Rust:** `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test --workspace --locked`, `cargo deny check`, `cargo audit`.
- **TS:** `npm run lint` (desktop dahil; CRM'de bu yoktu), `tsc -b`, `vitest`.
- **Sözleşme:** her senkron kaynak için wire fixture'ları **üç suite'te** (PHP, Rust, TS) çalışır. Hedef: kaynak başına create/update/conflict/reject senaryoları; CRM'de toplam 7 fixture vardı. Ayrıca ts-rs ve JSON Schema'dan üretilen tiplerde `git diff --exit-code`.
- **E2E (tauri-driver, Windows ve Linux):**
  1. Giriş → bootstrap.
  2. Ağ kesilir → taslak sipariş, sayım ve masraf girilir.
  3. Ağ gelir → push edilir, sunucuda görünür.
  4. Aynı taslak web'de değiştirilir → masaüstünde Conflict Inbox'a düşer.
  5. Kesinleştir butonu çevrimdışında devre dışı kalır.
  6. Pasifleştirilen kullanıcının yerel verisi silinir.
- **Manuel:** iki sunucu profili arasında geçiş, token'ın webview'de olmadığının kontrolü (DevTools), updater'ın test kanalından güncellemesi.

---

# BÖLÜM C — Dış etkili adımlar (her biri o anda ayrıca onaylanır)

- GitHub repolarının oluşturulması ve push. Önerilen adlar `Keystone-ERP` ve `Keystone-ERP-Desktop`; görünürlük (public/private) o adımda sorulur.
- PHP 8.4 kurulumu (Herd veya winget), Docker container'larının başlatılması.
- Seed, reset ve toplu silme gibi yıkıcı DB komutları (ENGINEERING-RULES §6).
- Masaüstü release'i için kod imzalama sertifikası (Windows Authenticode / Azure Trusted Signing) ve updater anahtarı. D6'da kararlaştırılır.
