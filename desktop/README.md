# Keystone masaüstü

Keystone ERP'nin Tauri 2 masaüstü uygulaması. Plan: [PLAN.md](PLAN.md). Mimari: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## D3: Tauri kabuğu

Kabuk derlenir ve açılır; sunucu profili, giriş, yerel kopya, çevrimdışı taslak ve realtime Rust tarafında çalışır. Arayüz D4'te gelir, bugün pencerede `app_info` çağıran smoke sayfası vardır.

Webview ağa çıkamaz: CSP `connect-src` yalnız IPC'ye izin verir, tüm istekler `api_request` komutundan geçer, token ve veritabanı anahtarı Rust tarafında kalır. Ayrıntı: [Güvenlik sınırı](docs/ARCHITECTURE.md#güvenlik-sınırı-csp-ve-izinler).

### Gereksinimler

- Rust: `rust-toolchain.toml` sürümü.
- Node 22.22 veya üstü. `npm ci` depo kökünde koşulur (`desktop` kök workspace üyesidir).
- Windows'ta SQLCipher derlemesi için Perl: `OPENSSL_SRC_PERL=C:/xampp/perl/bin/perl.exe`.
- Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf`.

### Komutlar

`desktop/` içinde:

| Komut | İş |
|---|---|
| `npm run tauri -- dev` | Vite ile geliştirme penceresi (`devCsp`) |
| `npm run tauri -- build --debug --no-bundle` | Paketsiz debug ikilisi, gerçek CSP ile |
| `npm run lint`, `npm run typecheck`, `npm run test` | TS kapıları |
| `cargo test --workspace --locked` | Rust testleri |
| `sh scripts/check-ts-types.sh` | Üretilen TS tipleri Rust DTO'larıyla aynı mı |

`http://localhost` sunucusuna bağlanmak için debug derlemede `KEYSTONE_DEV_ALLOW_HTTP=1` verilir. Release derleme bu değişkenle reddedilir.

Yeni bir izin ya da ağ kaynağı `tauri.conf.json` ve `capabilities/default.json` içine elle eklenmez: release kapısı (`src-tauri/src/build_guard.rs`) ve yapılandırma testleri (`src-tauri/src/lib.rs`) bilinçli güncelleme ister.
