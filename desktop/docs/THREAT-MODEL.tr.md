# Keystone masaüstü tehdit modeli

Kapsam: Tauri 2 masaüstü istemcisi (`desktop/`) ve oturumlar için dayandığı Laravel sunucu bölümleri (`backend/app/Modules/Identity`). Aşağıdaki her önlem, onu uygulayan dosyayı adlandırır; kodda olmayan bir önlem burada değil [Artık riskler](#artık-riskler) altında yazılıdır. Bu bir portfolyo projesidir: kod imzalama, otomatik güncelleyici ve üretim yayın kanalı yoktur; bu belge bunlardan hiçbirini varsaymaz.

İngilizce eş: [THREAT-MODEL.md](THREAT-MODEL.md). Mimari arka plan: [ARCHITECTURE.md](ARCHITECTURE.md).

## Varlıklar

| Varlık | Nerede durur | Neden önemli |
|---|---|---|
| Cihaz oturumu: erişim token'ı (60 dk) ve dönen yenileme token'ı (30 gün) | OS kimlik bilgisi deposu, servis `com.keystone.desktop`, hesap `<profil id>`, tek JSON kayıt `{tokens?, generation, deactivated}` (`crates/keystone-secrets/src/tokens.rs`, `keychain.rs`) | O sunucudaki kullanıcı verisine taşıyıcı erişim. Süreler: `backend/config/sanctum.php` (`device_access_ttl_minutes` 60), `DeviceTokens::payload` (varsayılan 30 gün). |
| SQLCipher anahtarı | OS kimlik bilgisi deposu, hesap `db-key:<profil id>`, 32 rastgele bayt, 64 hex (`crates/keystone-secrets/src/db_key.rs`) | Yerel kopyayı ve outbox'ı çözer. |
| Yerel kopya | `<app data>/profiles/<profil id>/keystone.db`, SQLCipher (`bootstrap.rs` `DB_FILE`, `crates/keystone-sync/src/store/mod.rs`) | İş verisinin çevrimdışı kopyası (cariler, siparişler, ...). |
| Outbox ve çakışmalar | Aynı şifreli veritabanı | Gönderilmemiş yazmalar; sunucunun henüz görmediği veri içerebilir. |
| Cihaz parmak izi yuvası | OS kimlik bilgisi deposu, `slot:<ad>` (`crates/keystone-secrets/src/slot.rs`) | Cihaz girişiyle birlikte gönderilen kurulum başına sır. |
| Profil kaydı | `<app data>/profiles.json` (`src-tauri/src/profiles.rs`) | Sunucu adresi, `meta` anlık görüntüsü, seçili şirket. Sır içermez; şifreli değildir. |
| Aktarımdaki parola | `auth_login` sırasında webview'dan Rust'a bir kez (`src-tauri/src/commands/auth.rs`) | İstemci saklamaz. |

## Güven sınırları

1. Webview (React paketi, `desktop/src` ve `frontend/src`) **tam güvenilmez** kabul edilir: sunucudan gelen veriyi gösterir. Ağ erişimi yoktur (CSP `connect-src ipc: http://ipc.localhost`), olay dinlemenin ötesinde Tauri plugin izni yoktur ve veriye yalnız `src-tauri/src/lib.rs` içindeki komutlarla (`generate_handler!`) ulaşır.
2. Rust kabuğu (`desktop/src-tauri`, `keystone-sync`, `keystone-secrets`, `keystone-realtime`) **güvenilirdir**. Token'ı, DB anahtarını ve HTTP istemcisini tutan tek koddur.
3. Sunucu kendi verisi için güvenilirdir, istemcinin güvenliği için değil: istemci profil adresini saldırgan seçmiş gibi ele alır (bkz. S1). Sunucudan istemciye yetki, API cevapları ve üç realtime kullanıcı olayıyla sınırlıdır.
4. OS kullanıcı hesabı dış sınırdır. Aynı kullanıcı olarak çalışan her şey bu modelin dışındadır (bkz. artık riskler).

## Saldırgan senaryoları

### S1. Kötü niyetli ya da ele geçirilmiş sunucu profili

Kullanıcı saldırganın sunucusuna işaret eden bir profil ekler ya da gerçek bir sunucu ele geçirilir.

Önlemler (doğrulandı):
- Yalnız `https://host[:port]`; yol, sorgu, parça ve kullanıcı bilgisi yok. Düz `http` yalnız loopback için ve yalnız **debug** derlemede `KEYSTONE_DEV_ALLOW_HTTP` ayarlıyken (`crates/keystone-sync/src/client/url.rs` `ServerUrl::parse`; `src-tauri/src/bootstrap.rs` `allow_http`). reqwest istemcisi de bu bayrak yoksa `https_only`'dir (`client/http.rs` `build_http`).
- Yönlendirmeler kapalıdır (`Policy::none()`), sunucu taşıyıcı token'ı başka kökene ya da http'ye sektiremez.
- Uç nokta yolları `/api/v1/` ile başlamalı ve düz segmentlerden oluşmalıdır (`ServerUrl::endpoint`); webview ya da sunucu verisi isteği başka yola ya da ana makineye yönlendiremez.
- Realtime: Reverb ana makinesi sunucunun `meta`'sından gelir, ama düz `ws` yalnız debug derleme, dev bayrağı ve loopback ana makine birlikte varsa kabul edilir (`crates/keystone-realtime/src/config.rs` `plain_allowed`). Aksi halde OS güven deposuyla `wss`. Token realtime crate'ine verilmez; kanal yetkisini Rust yapar (`broadcasting.rs`).
- Sunucu cevapları webview'a yalnız `api_request` sonucu olarak gelir; cevap başlıkları izin listesindedir (`client/http/proxy.rs` `RESPONSE_HEADERS`), gövde 32 MB ile sınırlıdır (`PROXY_BODY_LIMIT`).
- `profile_add`, `meta`'sı daha yeni uygulama ya da sync şeması isteyen sunucuyu reddeder (`bootstrap.rs`, `min_version`/`min_schema_version`).
- Bir profilin verisi diğerine karışmaz: kimlik `kullanıcı:şirket`tir ve farklı kimlik, bir şey push edilmeden önce kopyayı siler (`engine/pass.rs` `apply_session`).

Artık: kötü niyetli sunucu kullanıcının gördüğü veriyi tamamen belirler ve kendi giriş akışında kimlik bilgisi isteyebilir (`auth_login` parolayı profilin adlandırdığı sunucuya gönderir). Sertifika sabitleme (pinning) yoktur; güven OS kök deposudur (TLS hata nedeni gösterilir, `client/http.rs`, ama sabitlenmez).

### S2. Webview'da XSS ya da ele geçirilmiş kod

Önlemler (doğrulandı):
- `src-tauri/tauri.conf.json` içindeki CSP: `default-src 'self'; connect-src ipc: http://ipc.localhost; script-src 'self'; style-src 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; base-uri 'self'`. `unsafe-inline` ve `unsafe-eval` yok. Enjekte edilen betik `fetch`/XHR/WebSocket ile dışarı çıkamaz.
- CSP derlemede zorlanır: `src-tauri/build.rs` + `src/build_guard.rs` release derlemesini şu durumlarda durdurur: politika yok ya da yer tutucu, ağa açık `connect-src`, diğer yönergelerde uzak kaynak, nonce, güvensiz anahtar sözcük, `report-uri`, ikinci pencere, `dangerousDisableAssetCspModification`, `KEYSTONE_DEV_ALLOW_HTTP`.
- Gezinme kilidi: ana pencere kodda `on_navigation` (yalnız uygulama kökeni) ve `on_new_window` (her zaman reddet) ile kurulur (`src-tauri/src/lib.rs`, `app_url_allowed`, `create_main_window`); çünkü CSP üst düzey gezinmeyi kapsamaz.
- Capability asgaridir: `src-tauri/capabilities/default.json` `main` penceresine yalnız `core:event:allow-listen` ve `allow-unlisten` verir. fs, http, dialog, shell, pencere ya da yol izni yok; `withGlobalTauri` kapalı.
- Webview token görmez. Bearer başlığı Rust'ta eklenir; webview `Authorization` koyamaz, çünkü yalnız dört istek başlığı iletilir (`REQUEST_HEADERS`: `idempotency-key`, `accept-language`, `if-none-match`, `content-type`).
- Webview `api_request` ile `/api/v1/auth/*` (`GET auth/me` hariç), `/api/v1/sync/*` ve `broadcasting/auth` yollarına ulaşamaz (`client/http/proxy.rs` `FORBIDDEN`, `AUTH_READS`).
- Adres açmak webview yetkisi değildir: `open_external` üç sabit hedeften birini alır, adresi Rust'ta aktif profilden kurar (`src-tauri/src/commands/external.rs`).
- Loglama token, parola, kanal imzası, e-posta ve telefonu maskeler (`src-tauri/src/logging.rs`).

Artık: XSS kayıtlı her komutu oturum açmış kullanıcı olarak çağırabilir; örneğin izinli herhangi bir `/api/v1/` yolunda `api_request`, `auth_devices_revoke`, `auth_sign_out`, `profile_remove`. Ağdan sızdıramaz ve token'ı okuyamaz, ama kullanıcının yetkisiyle iş yapar ve izinli kanallardan veri sızdırmayı deneyebilir (örneğin API üzerinden sunucuya yazarak). Komutlar capability ile kapılı değildir (`ARCHITECTURE.md`: "Uygulama komutları capability ile kapılı değildir"); her biri kendi girdisini doğrular. Webview'da token yokluğu yalnız giriş öncesi ölçüldü (ARCHITECTURE "Takip listesi").

### S3. Çalınan cihaz ya da disk

Önlemler (doğrulandı):
- Veritabanı SQLCipher'dır (`rusqlite` özelliği `bundled-sqlcipher-vendored-openssl`, `Cargo.toml`); anahtar sıfırlanan bir tampondan `PRAGMA key` ile uygulanır (`store/mod.rs` `pragma_value`, `DbKey` `ZeroizeOnDrop`). Token'lar veritabanında yoktur (`engine/mod.rs` `engine_meta` notu).
- Anahtar OS CSPRNG'sinden üretilir ve yalnız kimlik bilgisi deposunda durur (`db_key.rs`); kopyalanmış bir `keystone.db` kullanıcının OS anahtarlığı olmadan okunamaz. Windows'ta depo, yerel makine kalıcılığıyla Credential Manager'dır (`keychain.rs`, `Keychain::native`).
- Eksik anahtar var olan veritabanının üstüne sessizce yenisini üretmez: kabuk `STORE_KEY_INVALID` döner ve kullanıcı karar verir (`bootstrap.rs`).
- `Secret` düşerken sıfırlanır ve `<redacted>` yazdırır (`auth/mod.rs`); anahtarlık kaydı sabit bir `Zeroizing` tampona serileştirilir (`tokens.rs` `Bounded`).
- Çıkış önce token neslini iptal eder, sonra kopyayı, outbox'ı, çakışmaları ve motor durumunu tek işlemde siler (`engine/mod.rs` `finish_sign_out`, `engine/local.rs` `wipe`); yarım kalan çıkış sürer ve erişimi kapalı tutar. `profile_remove` token'ları, DB anahtarını ve profil klasörünü siler (`bootstrap.rs`: `tokens.remove_profile`, `db_keys.remove`, `remove_dir_all`; aktif profilde gönderilmemiş outbox ya da çakışma işi varken zorlanmadıkça reddeder).

Artık: kilidi açık, oturumu açık bir cihaz hırsıza kullanıcıyla aynı erişimi verir, çünkü anahtarlık OS kullanıcısına açılır. Kopya boşta kalma, zamanlayıcı ya da ekran kilidiyle silinmez. `profiles.json` düz metindir (sunucu adresi, şirket id). Silinen satırlar veritabanı dosyasında sıfırlanır (yazıcıda `PRAGMA secure_delete = ON`); ancak veritabanı zaten diskte şifrelidir ve eski kopyalar bir sonraki checkpoint'e kadar WAL dosyasında, dosya sisteminin boşalan bloklarında ve SSD aşınma dağıtımında kalabilir; bu adli silme değildir. Webview'ın kendi depolama klasörü (WebView2 kullanıcı verisi) denetlenmedi.

### S4. Token tekrarı ya da token çalınması

Önlemler (doğrulandı, çoğu sunucu tarafı):
- Erişim token'ları kısa ömürlüdür (60 dk) ve Sanctum yeteneği `desktop` taşır (`DeviceTokens::ABILITY`).
- Yenileme token'ları özetlenmiş saklanır, kullanımda döner ve harcanmış token'ın yeniden gösterilmesi tüm cihaz ailesini siler (`DeviceTokens::rotate`: `used_at !== null` ardından `purge`). Yenileme cihaz başına hız sınırlıdır.
- `auth_version`: her parola ya da 2FA değişikliği `users.auth_version` değerini artırır (`app/Models/User.php`); eski sürümle üretilmiş yenileme token'ı cihaz ailesini öldürür (`DeviceTokens::rotate`, `$row->auth_version !== $user->auth_version`), değişiklikle yarışan bir giriş başarısız olur (`DeviceTokens` kilit altında üretim).
- İstemci tarafında token, giriş nesline bağlıdır: eski nesilden gelen sonuç ve yeniden denemeler atılır, yeni oturumu bozamaz (`client/http/proxy.rs`, `auth/mod.rs` karşılaştırmalı yazma).
- 401 en fazla bir yenileme ve bir yeniden deneme tetikler (`proxy.rs`).

Artık: 60 dakikalık süre dolmadan çalınmış erişim token'ı herhangi bir makineden çalışır; cihaza bağlı kanıt yoktur (DPoP ya da mTLS yok). Aynı kullanıcının bir süreci Credential Manager kaydını okuyabilir.

### S5. Uzaktan çıkış ve pasifleştirme

Önlemler (doğrulandı):
- `AccessRevoker::revokeAll` cihaz satırlarını ve token'ları siler ve `SessionRevoked` yayınlar (`backend/app/Modules/Identity/Services/AccessRevoker.php`). İstemci `.session.revoked` olayını realtime soketinden alır ve yalnız o neslin token'larını unutur (`src-tauri/src/realtime.rs`, ARCHITECTURE "Olaylar"). Pasifleştirilmiş kullanıcının yenilemesi reddedilir (`DeviceTokens::rotate` `'deactivated'` döner).
- İstemci `USER_DEACTIVATED`'i bitiren bir cevap sayar: yerel depoyu mühürler ve nesli, sonraki bir girişi koruyan karşılaştırmalı yazmayla pasif işaretler (`engine/mod.rs` 1215 civarı, `auth/mod.rs` `deactivate`). Pasifleştirmede mühür kopyayı, snapshot'ları, saklı `/auth/me` cevabını, outbox'ı ve çakışma kayıtlarını tek işlemde siler (`engine/local.rs` `seal(store, drop_work = true)`); gönderilmemiş taslaklar tasarım gereği kaybolur, çünkü kullanıcı pasifleştirilmiştir. Depo, aynı kimlik yeniden doğrulanana kadar kapalı kalır. Şirket erişimi kaybı (`COMPANY_FORBIDDEN`) kopyayı siler ama outbox ve çakışmaları yalnız mühürler (`drop_work = false`): kullanıcı hâlâ aktiftir ve erişimi geri alabilir. Yazıcı bağlantı `PRAGMA secure_delete = ON` ayarlar (`store/mod.rs`); silinen satırlar veritabanı dosyasında sıfırlanır.
- Yerel veri başka kullanıcı ya da şirkete aitse kopya push'tan önce silinir (`engine/pass.rs`).
- `auth_devices_list` ve `auth_devices_revoke` kullanıcının diğer cihazları iptal etmesini sağlar.

Artık: bunların hepsi istemcinin sunucuyla konuşmasını gerektirir. Çevrimdışı cihaz, sunucuya ulaşana kadar verisini ve token'ını tutar. Yalnız şirket erişimi kaybı mühürü outbox ve çakışma kayıtlarını hâlâ tutar (mühürlü; aynı kimlik yeniden doğrulanana kadar açılmaz). `.session.revoked` olayı token'ları düşürür ama tek başına yerel veriyi silmez (ARCHITECTURE); silme sonraki koşuda olur. Profil değişimiyle 3 sn içinde kesilen revoke, token'ı sonraki 401'e kadar bırakabilir (ARCHITECTURE "Takip listesi", "Kesilen revoke").

### S6. Kurcalanmış derleme (güncelleyici yok)

Otomatik güncelleyici yoktur (`tauri-plugin-updater` `Cargo.toml`/`tauri.conf.json` içinde yok) ve kod imzalama yoktur. Yani kaçırılacak bir güncelleme kanalı yoktur, ama kullanıcının bir ikiliyi doğrulama yolu da yoktur.

Önlemler (doğrulandı):
- Release derlemeleri zayıflatılmış CSP/yapılandırmayı reddeder (derleme kapısı, yukarıda) ve `KEYSTONE_DEV_ALLOW_HTTP` release'te yok sayılır (`bootstrap::allow_http`).
- CI'da bağımlılık denetimi: `cargo deny check`, `cargo audit` (`deny.toml`, ARCHITECTURE "Doğrulama").
- Yalnızca hata ayıklama WebDriver kancası: Windows e2e takımı için, Windows'ta bir debug derleme `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` değerini (msedgedriver'ın `--remote-debugging-port` argümanı) ana pencerenin WebView2 argümanlarına ekler (`src-tauri/src/webdriver_hook.rs`). Modül yalnızca Windows'ta `debug_assertions` ile derlenir; release derlemesi değişkeni okumaz, adını da içermez. `desktop-bundle.yml` release ikilisinde bu adı arar, bulursa derlemeyi düşürür.
- Devtools: `tauri` crate'i `devtools` özelliği olmadan derlenir (`src-tauri/Cargo.toml`); release webview'ı varsayılan olarak bunu açmaz.

Artık: ikiliyi diskte değiştirebilen kullanıcının oturumunu ele geçirir. İkililer imzasızdır; Windows SmartScreen uyarır ve bütünlük doğrulanamaz. Portfolyo projesi için kabul edilmiştir.

### S7. IPC kötüye kullanımı (webview ya da enjekte betik komut çağırır)

Önlemler (doğrulandı):
- Komut yüzeyi `lib.rs` `generate_handler!` içindeki sabit listedir; her komut `Result<T, CommandError>` döner ve girdiyi doğrular. `api_request` tek veri kapısıdır; yöntem/yol/başlık/gövde sınırları S1 ve S2'de.
- Tek capability dosyası `main`'e bağlıdır, `remote.urls` yoktur; uzak bir köken komut çağıramaz (`capability_has_only_the_expected_keys` testi).
- İkinci pencere açılamaz: `build_guard` başka pencereli yapılandırmayı reddeder, `on_new_window` reddeder. `tauri-plugin-single-instance`, ikinci sürecin aynı anahtarlığı eşzamanlı açmasını önler (`lib.rs`; anahtarlıkta süreçler arası kilit yok).
- Idempotency anahtarları yerelde saklanır ve tekrarlanır; aynı anahtarın başka istekle kullanımı reddedilir (`IDEMPOTENCY_KEY_REUSED`).

Artık: bkz. S2. Komut başına yetkilendirme ya da kullanıcı onayı yoktur; `profile_remove` ya da `auth_sign_out` gibi yıkıcı bir komut webview'da çalışan her betiğe açıktır.

## Mevcut önlemler, kod yoluyla

| Önlem | Yol |
|---|---|
| CSP | `desktop/src-tauri/tauri.conf.json` (`app.security.csp`) |
| CSP / yapılandırma derleme kapısı | `desktop/src-tauri/build.rs`, `desktop/src-tauri/src/build_guard.rs` |
| Gezinme ve yeni pencere kilidi | `desktop/src-tauri/src/lib.rs` |
| Capability | `desktop/src-tauri/capabilities/default.json` |
| Komut listesi | `desktop/src-tauri/src/lib.rs` (`generate_handler!`) |
| Başlık izin listesi, yasak yollar, gövde sınırı | `desktop/crates/keystone-sync/src/client/http/proxy.rs` |
| Yönlendirme yok, yalnız https, zaman aşımları | `desktop/crates/keystone-sync/src/client/http.rs` (`build_http`) |
| Sunucu adresi doğrulama | `desktop/crates/keystone-sync/src/client/url.rs` |
| Anahtarlıkta token kaydı | `desktop/crates/keystone-secrets/src/tokens.rs`, `keychain.rs` |
| SQLCipher anahtarı | `desktop/crates/keystone-secrets/src/db_key.rs`, `desktop/crates/keystone-sync/src/store/mod.rs` |
| Çıkış, mühür, silme | `desktop/crates/keystone-sync/src/engine/mod.rs`, `engine/local.rs`, `engine/pass.rs` |
| Realtime revoke | `desktop/src-tauri/src/realtime.rs`, `desktop/crates/keystone-realtime/src/` |
| Log maskeleme | `desktop/src-tauri/src/logging.rs` |
| Sunucu: cihaz token'ları, `auth_version`, iptal | `backend/app/Modules/Identity/Services/DeviceTokens.php`, `AccessRevoker.php`, `backend/app/Models/User.php`, `backend/config/sanctum.php` |

## Artık riskler

1. Aynı kullanıcının kötü amaçlı yazılımı Credential Manager kayıtlarını (token ve DB anahtarı) ve veritabanını okur. Güvenin kökü OS anahtarlığıdır.
2. Çalınan dizüstünde açık oturum: boşta kilit yok, uygulamayı açmak için yeniden kimlik doğrulama yok.
3. Çalınan erişim token'ı 60 dakikaya kadar geçerlidir; cihaza bağlı değildir.
4. Sertifika sabitleme yok; kullanıcının ya da kurumun kurduğu kök CA TLS'i araya girerek okuyabilir.
5. Çevrimdışı iptal boşluğu: pasifleştirilmiş ya da iptal edilmiş cihaz, sunucuya ulaşana kadar verisini ve token'ını tutar. Pasifleştirme mühürü outbox ve çakışmaları kopyayla birlikte siler; yalnız şirket erişimi kaybı mühürü onları mühürlü tutar.
6. XSS, kayıtlı tüm komutlar üzerindeki kullanıcı yetkisini korur (ağ yok, token okuma yok, ama yıkıcı komutlara ulaşılır).
7. Kod imzalama, güncelleme kanalı ve tekrarlanabilir derleme yok: ikili bütünlüğü doğrulanamaz.
8. `profiles.json` düz metin; silinen satırların eski kopyaları `secure_delete`'e rağmen WAL'da, dosya sistemi bloklarında ve SSD eşlemesinde kalabilir; WebView2'nin kendi kullanıcı verisi klasörü denetlenmedi.
9. Bellek: sıfırlama Rust'taki anahtar ve token tamponlarını kapsar, ama çalışan sürecin hata ayıklayıcı ya da çökme dökümü sırları okuyabilir; bellek takasa karşı kilitlenmez.
10. `ARCHITECTURE.md` "Takip listesi"nden açık kalanlar (kesilen revoke; giriş sonrası webview'da token yokluğu yalnız elle ölçülecek).

## Kapsam dışı

Oturum uç noktalarının ötesinde sunucu sertleştirmesi, çalışan açık makineye fiziksel saldırılar, `cargo deny`/`cargo audit` ötesinde tedarik zinciri ve her türlü yayın, imzalama ya da barındırma konusu.
