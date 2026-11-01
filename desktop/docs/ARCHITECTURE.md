# Keystone masaüstü mimarisi (D3)

Bu not D3 sonundaki Tauri kabuğunu anlatır: webview'ın ne yapabildiği, isteklerin nerede cevaplandığı, sırların nerede durduğu ve bilinen sınırlar. Planın kendisi `desktop/PLAN.md`, sunucu sözleşmesi `docs/SYNC-PROTOCOL.md` ve `contracts/` altındadır.

## Katmanlar

| Katman | Yer | Görev |
|---|---|---|
| Webview | `desktop/src` | Arayüz. D3'te yalnız smoke sayfası; React uygulaması D4'te gelir. Ağa çıkamaz, yalnız komut çağırır. |
| Köprü | `desktop/src/bridge` | Tipli `invoke`/`listen` sarmalayıcıları. `generated/` Rust DTO'larından üretilir. |
| Kabuk | `desktop/src-tauri` | Komutlar, yönlendirme, profiller, realtime köprüsü, loglama. |
| `keystone-sync` | `desktop/crates/keystone-sync` | HTTP istemcisi, SQLCipher yerel kopya, outbox, conflict, sync döngüsü. |
| `keystone-secrets` | `desktop/crates/keystone-secrets` | OS keychain üzerinde token, DB anahtarı ve kurulum sırları. |
| `keystone-realtime` | `desktop/crates/keystone-realtime` | Reverb (Pusher protokol 7) istemcisi. HTTP ve token erişimi yoktur. |

Tipler sınırı geçerken kabuk DTO'larına çevrilir; crate tipleri webview'a doğrudan verilmez (`src-tauri/src/dto`). `sh desktop/scripts/check-ts-types.sh` üretilen TS tiplerini Rust ile karşılaştırır, CI'da `desktop-shell` işinde koşar.

## Komut yüzeyi

Her komut `Result<T, CommandError>` döner; hata `{code, message, retry_after?}` biçimindedir. UI `code` ile anahtarlar (`desktop.errors.<code>`), `message` yalnız tanı içindir. Komut listesinin tek kaynağı `src-tauri/src/lib.rs` içindeki `generate_handler!` çağrısıdır.

| Grup | Komutlar | Not |
|---|---|---|
| Tanı | `app_info` | Sürüm, kimlik, şema sürümü, işletim sistemi, debug. Sır yok. |
| API | `api_request` | Webview'ın tek veri kapısı. Bkz. [Yönlendirme](#yönlendirme). |
| Profil | `profile_add`, `profile_list`, `profile_select`, `profile_reset`, `profile_remove`, `profile_select_company` | `profile_add` sunucunun `meta` yanıtını okur; `desktop.min_version` ve şema sürümü uymazsa reddeder. |
| Kimlik | `auth_login`, `auth_restore`, `auth_sign_out`, `auth_devices_list`, `auth_devices_revoke` | Parola webview'dan Rust'a bir kez geçer, tutulmaz. Token webview'a hiç dönmez. |
| Sync | `sync_now`, `sync_status`, `outbox_list`, `outbox_retry`, `outbox_discard`, `conflicts_list`, `conflicts_resolve` | Bekleyen iş yönetimi ve Conflict Inbox. |
| Realtime | `realtime_status` | Başlangıç durum olayı webview dinlemeye başlamadan gidebileceği için anlık durum sorgusu. |

### Olaylar

Webview'a iki sıralı olay akar, ikisinde de her yük `profile_id` taşır; UI terk ettiği profilin haberini atar.

| Olay | Yük | Kaynak |
|---|---|---|
| `engine-event` | `{type: status, ...}`, `{type: resources_changed, ...}` | `src-tauri/src/events.rs` |
| `realtime-event` | `state`, `session_revoked`, `membership_revoked`, `notification_created` | `src-tauri/src/realtime.rs` |

Reverb soketi Rust tarafında açılır, webview CSP'sine girmez. Olay etkileri:

- `.session.revoked`: `forget_tokens(g)` nesil karşılaştırmalı çalışır, sonra `trigger(Manual)` ve UI olayı. Yerel veri silinmez; sonraki koşu `AuthRequired` olur ve yerel okumayı mühürler. Eski nesilden gelen olay yok sayılır.
- `.membership.revoked`: `trigger(Manual)` ve UI olayı.
- `.notification.created`: yalnız UI olayı.

## Yönlendirme

`api_request` isteği doğrular, `Idempotency-Key` tekrarını yönlendirmeden önce cevaplar, sonra yol tablosuna bakar. Tablo `contracts/offline-manifest.json` dosyasından çalışma anında okunur (`router/decide.rs`). `{param}` yalnız UUID ile eşleşir.

### Okuma

| Kaynak | Çevrimiçi | Çevrimdışı |
|---|---|---|
| Tabloda yok | Sunucu | `OFFLINE_UNAVAILABLE` (503) |
| Yerel kopya hiç inmemiş | Sunucu | `OFFLINE_UNAVAILABLE` (503) |
| `local-first`, kopya tam | Yerel | Yerel |
| `local-first`, kopya yarım | Sunucu (5 sn), düşerse yerel `stale` | Yerel, `partial` |
| `online-first` | Sunucu (5 sn), düşerse yerel `stale` | Yerel, `stale` |
| `offline-fallback` (snapshot) | Sunucu | Saklı snapshot, `as_of` etiketli |

Yerel kopya bir isteği karşılayamıyorsa (indekslenmemiş filtre, inmemiş snapshot) çevrimiçiyken istek sunucuya gider, çevrimdışıyken `meta.offline.unsupported_filters` ile reddedilir. Yerel yanıtlar Laravel zarfını birebir taşır, `meta.offline` altında `as_of`, `partial`, `stale` bulunur.

### Yazma

| Durum | Sonuç |
|---|---|
| Çevrimiçi | Sunucu |
| Çevrimdışı, yerel depo yok | `OFFLINE_UNAVAILABLE` (503) |
| Çevrimdışı, manifest uyuşmuyor | `SYNC_OFFLINE_WRITE_NOT_ALLOWED` (422) |
| Çevrimdışı, işlem `WritePolicy` dışında | `OFFLINE_UNAVAILABLE` (503) |
| Çevrimdışı, işlem izinli | Outbox taslağı; satır düzeyi kurallar kuyruğa girerken denetlenir (`DOCUMENT_LOCKED` vb.) |

Sessiz üzerine yazma yoktur: taslak `base_version` taşır, çakışma Conflict Inbox'a düşer.

`Idempotency-Key` cihazda 7 gün saklanır. Kayıtlı anahtar sunucuya gönderilmez; tekrar aynı satır kimliğini ve durum kodunu döner, gövde satırın o anki halidir. Aynı anahtar başka istekle gelirse `IDEMPOTENCY_KEY_REUSED` (422).

### Ağa açılan kapı

`HttpClient::proxy` yalnız `/api/v1/` altına gider. Webview'dan yasak yollar: `/api/v1/auth` ve altı (yalnız `GET /api/v1/auth/me` hariç), `/api/v1/sync` ve altı, `/api/v1/broadcasting/auth`. Bunları yalnız Rust tarafı kendi komutlarıyla çağırır. İstek başlıkları `idempotency-key`, `accept-language`, `if-none-match`, `content-type` ile, yanıt başlıkları `content-type`, `content-disposition`, `etag`, `retry-after`, `x-request-id` ile sınırlıdır. Gövde sınırı 32 MB'dir. Bearer token isteğe Rust'ta eklenir.

## Keychain sözleşmesi

Servis adı `com.keystone.desktop`. Sırlar yalnız OS keychain'inde durur.

| Hesap adı | İçerik |
|---|---|
| `<profil id>` | Oturum kaydı, JSON: `{tokens?, generation, deactivated}` |
| `db-key:<profil id>` | SQLCipher anahtarı, 64 hex |
| `slot:<ad>` | Kurulum sırrı (cihaz parmak izi), 64 hex |

- Profil başına tek oturum kaydı: `take`, `sign_in`, `deactivate`, `sign_out` tek yazımdır, parçalı kayıt oluşmaz. Boyut Windows Credential Manager sınırının (2560 bayt) altında tutulur.
- `generation` hiçbir yolla sıfırlanmaz. Süresi dolan kararlar nesil karşılaştırmasıyla uygulanır, eski nesilden gelen sonuç yeni oturumu bozamaz.
- Tek süreç içinde aynı servisin tüm handle'ları tek kilit ve tek önbelleği paylaşır. Yazma önce keychain'e gider; başarısızsa önbellek değişmez.
- `DbKey` bellekte `Zeroizing` ile taşınır. Keychain kaybında veri otomatik silinmez: `STORE_KEY_INVALID` döner, kullanıcı onayıyla profil verisi silinip yeniden indirilir.
- `profiles.json` (app data) sunucu adresi, `meta` anlık görüntüsü ve seçili şirketi tutar; sır içermez.

## Güvenlik sınırı: CSP ve izinler

### CSP

`tauri.conf.json` içindeki politika:

```
default-src 'self'; connect-src ipc: http://ipc.localhost; img-src 'self' data: blob:;
font-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none';
frame-ancestors 'none'; form-action 'none'
```

- `connect-src` yalnız IPC'dir: `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` ve `sendBeacon` dış adrese, hatta uygulamanın kendi kökenine çıkamaz. İki adres de gerekir, çünkü IPC Windows'ta `http://ipc.localhost`, diğer sistemlerde `ipc:` üzerinden gider. Biri eksik olursa IPC kırılmaz ama sessizce yavaş `postMessage` yoluna düşer.
- Tauri paketli varlıklardaki `script-src` ve `style-src` yönergelerine hash ve nonce ekler (`dangerousDisableAssetCspModification` kapalı kalır). Bu nedenle webview'ın gördüğü başlık yapılandırma metniyle aynı değildir. Windows'ta `tauri build --debug` ikilisinde ölçülen başlık (`http://tauri.localhost/`):

  ```
  connect-src ipc: http://ipc.localhost; script-src 'self' 'sha256-…'; font-src 'self' data:;
  form-action 'none'; img-src 'self' data: blob:; frame-ancestors 'none'; style-src 'self';
  object-src 'none'; default-src 'self'
  ```

  Aynı pencerede dış `fetch`/XHR/WebSocket/EventSource/beacon `connect-src`, dış görsel `img-src`, satır içi betik ve `eval` `script-src`, satır içi stil özniteliği `style-src-attr` ihlaliyle engellendi; `app_info` ve olay dinleme çalıştı.
- `style-src-attr 'unsafe-inline'` yoktur: bugünkü sayfada satır içi stil ölçülmedi. Radix ve sonner gelince D4 ölçerek ekler.
- `keystone-asset:` D5'te eklenir.
- `devCsp` yalnız `tauri dev` içindir, tek farkı Vite'ın `ws://localhost:1420` soketidir.

### Derleme kapısı

`src-tauri/build.rs`, `src/build_guard.rs` üzerinden etkin yapılandırmayı tauri-build ile aynı sırada birleştirir: `tauri.conf.json`, varsa `tauri.<os>.conf.json`, varsa `TAURI_CONFIG`. Release derlemesi şu durumlarda durur:

- politika yok ya da yer tutucu (`keystone-placeholder-csp`);
- `connect-src` tam olarak `ipc:` ve `http://ipc.localhost` değil (`http:`, `https:`, `ws:`, `wss:`, adres, `*`, `'self'` reddedilir, yönerge yoksa da reddedilir);
- `dangerousDisableAssetCspModification` açık;
- `KEYSTONE_DEV_ALLOW_HTTP` ayarlı.

Debug derlemesi aynı sorunlarda yalnız uyarır; `tauri build --debug` çıktısı dağıtılmaz. `KEYSTONE_DEV_ALLOW_HTTP=1` yalnız debug derlemede etkilidir (`bootstrap::allow_http`), release ikilisi değişkeni okusa da yok sayar.

### Capability

`capabilities/default.json` tek capability'dir, yalnız `main` penceresine bağlıdır. `core:default` kullanılmaz; verilenler:

| İzin | Neden |
|---|---|
| `core:event:allow-listen`, `allow-unlisten` | `engine-event`, `realtime-event` dinleme |
| `core:event:allow-emit` | Plan D4 için ayırdı; bugün kullanılmıyor |
| `core:window:allow-show`, `allow-hide`, `allow-set-focus`, `allow-minimize`, `allow-close` | Pencere yönetimi; plan D4 için ayırdı, bugün kullanılmıyor |
| `os:allow-platform` | Etkisiz: tauri-plugin-os 2'de `platform` komut değildir, değer başlangıç betiğiyle gelir (pencerede `Command platform not found`) |
| `process:allow-restart` | Yeniden başlatma; plan D5 için ayırdı, bugün kullanılmıyor |
| `shell:allow-open` | Dış `https` bağlantısını varsayılan tarayıcıda açma |

`fs`, `http`, `dialog`, `core:path`, `core:app`, `core:webview` izinleri yoktur; pencerede bu komutlar `not allowed` ile reddedildi. Uygulama komutları capability ile kapılı değildir; kendi doğrulamalarını yapar.

`shell:allow-open` için URL sınırı capability'de değil, `plugins.shell.open` deseninde durur: plugin `open` komutunda yalnız bu deseni uygular, capability kapsamına URL yazmak etkisizdir. Plugin deseni `^{desen}$` olarak derler; desen `https://\S+` olduğundan boşluk ya da satır sonu içermeyen `https://` adresleri kabul edilir, `http`, `file`, `mailto`, `tel` ve yol reddedilir. D3 öncesindeki `^https://` deseni `^^https://$` olarak derlendiği için hiçbir gerçek adresi kabul etmiyordu. Desen kaldırılırsa plugin varsayılanı `http`, `mailto`, `tel` açar; `shell_open_is_limited_by_the_config_pattern` testi deseni plugin gibi derleyip sabitler.

### Tek örnek

`tauri-plugin-single-instance` ilk plugin'dir. İkinci açılış pencereyi öne getirip çıkar. Keychain için süreçler arası kilit olmadığından bu zorunludur.

### Loglama

Log formatı `src-tauri/src/logging.rs` içinde maskelenir: token, parola, kanal imzası, e-posta, telefon. `tungstenite` hedefleri en fazla `Info` seviyesindedir, çünkü `Trace` çerçeveleri imza içerir. Release seviyesi `Info`'dur. Webview log hedefi yoktur.

## Çalışma düzeni

- Motor döngüsü ve realtime köprüsü ayrı tokio runtime iş parçacığında koşar (`runtime.rs`). Komut tarafındaki store işleri `spawn_blocking` ile yapılır. Motorun içindeki store çağrıları senkrondur; uzun SQLite işi sırasında soket ping'i gecikebilir.
- Sync 60 sn zamanlayıcı, `sync_now` ve realtime tetikleriyle koşar.
- Profil değişiminde köprü en fazla 3 sn beklenir, sonra kesilir.
- Bağlantı durumu son proxy sonucundan (30 sn) ya da motor durumundan okunur.

## Bilinen sınırlar

### Tasarım gereği

- Süreçler arası kilit yok: keychain karşılaştırmalı yazma sunmaz. Tek örnek ile kapatılır.
- `Retry-After` sınırı bellektedir: yeniden başlatınca unutulur.
- SSE yok: `streamPost` ve asistan akışı D3 dışıdır, komutlar yanıtı tek parça döner. D4/D5'te Tauri `Channel` ile gelir.
- Kaynak değişikliği yayını yok: realtime yalnız üç kullanıcı olayı taşır, tazelik 60 sn döngüsüyle sağlanır. Web'e `sync.changed` backlog'da.
- Çevrimdışı filtre ve sıralama yalnız `search`, sayfalama ve manifest `window_field` ile sınırlıdır.
- Presence kanalı yok.

### Takip listesi

| Konu | Etki | Kapatma yolu |
|---|---|---|
| `Arc::ptr_eq` denetimi ile `put_snapshot` arası pencere; `check_access` şirket karşılaştırmaz | Aynı nesilde tam o anda şirket değişirse snapshot eski şirkete yazılabilir | Şirket değişimi işinde crate kimliği sorgulatır |
| `snapshot_refresh_minutes` döngüsü yok | Snapshot yalnız UI o GET'i yaparsa tazelenir, hiç açılmamış ekran çevrimdışı 503 döner | Motor döngüsüne eklenir |
| Mühürlü veride `Idempotency-Key` kaydı okunamaz | Yeniden girişte ilk koşu bitmeden aynı anahtarla tekrar mükerrer olabilir | `Outbox::request_record` yalnız `ensure_unsealed` |
| Kesilen revoke | Profil değişimi işlenen `.session.revoked` olayını 3 sn sonra keserse token sonraki 401'e kadar kalır; sunucu oturumu zaten bitmiştir | `forget_tokens` ayrı görevde |
| Şirketsiz profilde `AuthRequired` yok | Revoke token'ı düşürür, UI olayı gider, motor durumu oluşmaz | Şirket seçilmeden döngü yok; `auth_state` tutarlı |
| `meta_snapshot` tazelenmez | Sunucu Reverb ayarı değişince profil yeniden eklenmelidir | Meta yenileme yolu |
| `keystone-realtime` `event.rs` ve `lib.rs` doc'ları bayat | Yanıltıcı yorum; davranış yukarıda anlatıldığı gibidir | Sonraki crate turu |
| Realtime test boşlukları | Soket sırası durum sırasından, log tavanı kaynak metninden sınanıyor | Mock uygulamalı test |
| `mask` kaçışlı JSON ve `Value` Debug biçimlerini yakalamaz | Bugün bu biçimde log yazan kod yok | `SECRET_FIELD` genişletilir |
| `a_sign_in_during_the_call_sends_it_once_more` | 150 ms bekleme nedeniyle yük altında kırılgan | Sabit bekleme yerine olay |
| `allow-emit`, `core:window:*`, `os:allow-platform`, `process:allow-restart` | Bugünkü sayfa kullanmıyor, plan D4/D5 için ayırdı | D4 sonunda kullanılmayan çıkarılır |
| `shell` plugin'inin `open` komutu kullanımdan kalkıyor | Davranış bugün doğru | `tauri-plugin-opener` (`opener:allow-open-url` URL kapsamını uygular) |
| Webview'da token yokluğu yalnız giriş öncesi ölçüldü | Giriş sonrası depolama ve bellek araması elle yapılacak | Kapanış turu |

## Doğrulama

- Rust: `cd desktop && cargo fmt --all -- --check && cargo clippy --workspace --all-targets --locked -- -D warnings && cargo test --workspace --locked && sh scripts/gen-wire.sh && cargo deny check && cargo audit`
- TS: `npm run -w desktop lint && npm run -w desktop typecheck && npm run -w desktop test`
- Tipler: `sh desktop/scripts/check-ts-types.sh`
- Kabuk derlemesi: `cd desktop && npm run tauri -- build --debug --no-bundle`
