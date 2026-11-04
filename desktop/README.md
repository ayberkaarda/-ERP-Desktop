# Keystone masaüstü

Keystone ERP'nin Tauri 2 masaüstü uygulaması. Plan: [PLAN.md](PLAN.md). Mimari: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## D3: Tauri kabuğu

Kabuk derlenir ve açılır; sunucu profili, giriş, yerel kopya, çevrimdışı taslak ve realtime Rust tarafında çalışır. Pencere web uygulamasını (`frontend/src`) masaüstü platformuyla açar: `vite.desktop.config.ts` platform çalışma modülünü ve uzantı noktalarını masaüstü karşılıklarıyla değiştirir, axios/Echo pakete girmez. Masaüstü ekranları (senkron durumu, profil ve giriş) D4 paketleriyle gelir.

Webview'ın `fetch`, XHR, WebSocket, EventSource ve dış görsel istekleri CSP ile kapalıdır (`connect-src` yalnız IPC). Dış adrese gezinme ve `window.open` navigasyon kilidiyle engellenir. Veri `api_request` komutundan geçer, token ve veritabanı anahtarı Rust tarafında kalır. Webview'ın URL açma izni yoktur; web sayfaları `open_external(target)` komutuyla sabit hedef listesinden, Rust tarafında açılır. `tauri dev` penceresi de aynı politikayı Vite'tan alır (`devCsp`). Ayrıntı: [Güvenlik sınırı](docs/ARCHITECTURE.md#güvenlik-sınırı-csp-ve-izinler).

### Gereksinimler

- Rust: `rust-toolchain.toml` sürümü.
- Node 22.22 veya üstü. `npm ci` depo kökünde koşulur (`desktop` kök workspace üyesidir).
- Windows'ta SQLCipher derlemesi için Perl: `OPENSSL_SRC_PERL=C:/xampp/perl/bin/perl.exe`.
- Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf`.

### Komutlar

`desktop/` içinde:

| Komut | İş |
|---|---|
| `npm run tauri -- dev` | Vite ile geliştirme penceresi. CSP burada uygulanmıyor (sayfa Vite'tan gelir); CSP ihlallerini görmek için debug ikilisi kullanılır |
| `npm run tauri -- build --debug --no-bundle` | Paketsiz debug ikilisi, gerçek CSP ile |
| `npm run lint`, `npm run typecheck`, `npm run test` | TS kapıları |
| `cargo test --workspace --locked` | Rust testleri |
| `sh scripts/check-ts-types.sh` | Üretilen TS tipleri Rust DTO'larıyla aynı mı |

`http://localhost` sunucusuna bağlanmak için debug derlemede `KEYSTONE_DEV_ALLOW_HTTP=1` verilir. Release derleme bu değişkenle reddedilir.

Yeni bir izin ya da ağ kaynağı `tauri.conf.json` ve `capabilities/default.json` içine elle eklenmez: release kapısı (`src-tauri/src/build_guard.rs`) ve yapılandırma testleri (`src-tauri/src/lib.rs`) bilinçli güncelleme ister.

### İmzasız kurulum paketi

Kurulum paketleri **imzasızdır**: kod imzalama, noter onayı (notarization) ve otomatik güncelleme yoktur; bu bir portfolyo projesidir. Windows SmartScreen ve macOS Gatekeeper uyarı verir, paketi elle onaylamak gerekir.

- CI: GitHub Actions'ta "Desktop Bundle" iş akışı elle (`workflow_dispatch`) ya da `desktop-v*` etiketinde çalışır. Windows, Linux ve macOS paketlerini `keystone-desktop-unsigned-<os>` adlı iş akışı çıktısı (artifact) olarak yükler; release ya da etiket oluşturmaz.
- Yerelde: `npm ci` (depo kökü), sonra `desktop/` içinde `npm run tauri -- build`. Paketler `target/release/bundle/` altına çıkar.
- CI matrisi: `Desktop Rust` iş akışı Rust testlerini ve kabuk derlemesini Windows ve macOS'ta da koşar (`rust-os`, `shell-os`); Linux işleri (`rust`, `desktop-shell`) adlarıyla aynı kaldı.
