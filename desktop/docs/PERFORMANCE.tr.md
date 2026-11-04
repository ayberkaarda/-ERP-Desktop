# Keystone masaüstü performansı

Durum: 2026-11-04'te ilk soğuk açılış ve boşta bellek taban değeri ölçüldü (aşağıda). **`window_ms` ve `ready_ms` değerleri kronometreyle karşılaştırılmadı**, bu yüzden gösterge olarak okuyun; bellek değerleri doğrudan süreç sayaçlarıdır.

## Yöntem

`desktop/scripts/measure-perf.ps1` (Windows, PowerShell) derlenmiş ikiliyi `-Runs` kez başlatır, her seferinde önceki süreç ağacını kapatır ve şunları kaydeder:

- `window_ms`: başlangıçtan sürecin üst düzey bir pencereye sahip olmasına kadar.
- `ready_ms`: başlangıçtan, en az `-MinProcesses` sürecin (uygulama ve `msedgewebview2` yardımcıları) var olduğu ve tüm ağacın `-QuietMs` boyunca CPU'da sessiz (`-QuietCpuPercent`, varsayılan %3) kaldığı ana kadar.
- Hazır olduktan `-IdleSeconds` sonra süreç ağacı toplamı boşta çalışma kümesi ve özel bayt.

Koşular soğuk süreç başlatmadır, soğuk disk önbelleği değildir. Uygulama makinede ne profil durumu varsa onunla açılır. Çalışma kümesi WebView2 süreçleri arasında paylaşılan sayfaları iki kez sayar; özel bayt daha iyi göstergedir. Linux/macOS betiği yoktur: orada hazır sinyali, sınanamayan pencere sistemi araçları gerektirirdi.

```
cd desktop
npm run tauri -- build --no-bundle
powershell -NoProfile -File scripts/measure-perf.ps1 -Exe target/release/keystone-desktop.exe -Runs 10 -Json perf-release.json
```

Bilinen uyarı: betiğin önceki bir sürümüyle (`-MinProcesses` öncesi) yapılan deneme gerçekçi olmayan erken hazır süreleri verdi; çünkü webview yardımcıları başlamadan CPU sessiz görünüyordu. Depodaki sürüm bu kapıyı ekler; aşağıdaki koşu onunla yapıldı ve her koşuda 7 süreç görüldü, ama `ready_ms` yine de bir kronometreyle karşılaştırılmadı.

## Taban değer (2026-11-04)

`main`'in (`d7c0de1`) release derlemesi, 5 koşu, `-IdleSeconds 15`, sunucu profili yok ("sunucu ekle" ekranı, ağ yok). Makine aşağıdakiyle aynı.

| Ölçüt | Medyan | Aralık |
|---|---|---|
| `window_ms` (ilk üst düzey pencere) | 49 ms | 31-512 ms |
| `ready_ms` (webview yüklendi, CPU sessiz) | 469 ms | 423-1410 ms |
| Boşta özel bayt (tüm süreç ağacı) | 199 MB | 196-202 MB |
| Boşta çalışma kümesi (tüm süreç ağacı) | 416 MB | 414-430 MB |

Notlar: 1. koşu oturumun ilk başlatmasıydı ve en yavaşıydı (512 ms ve 1410 ms); 2-5. koşular 31-51 ms ve 423-483 ms. Tüm koşularda 7 süreç vardı (uygulama ve WebView2 yardımcıları). Bu kadar küçük `window_ms`, pencerenin boyanmadan önce oluştuğunu düşündürüyor. Çalışma kümesi WebView2 süreçleri arasında paylaşılan sayfaları iki kez sayar; alıntılanacak değer özel bayttır. Dosya önbelleği koşular arasında sıcak kalır, yani bunlar soğuk disk değerleri değildir. Bu koşunun derlemesi 8 dk 4 sn sürdü (`tauri build --no-bundle`, `tsc` adımı olmadan) ve 25,3 MB'lık `keystone-desktop.exe` üretti.

## Pencere açmadan ölçülenler

Makine: AMD Ryzen 5 7600 (6 çekirdek, 12 iş parçacığı), 31 GB RAM, Windows 11 Pro 10.0.26300.

| Kalem | Değer | Nasıl |
|---|---|---|
| Release ikilisi `keystone-desktop.exe` | 24,2 MB | `tauri build --no-bundle`, dosya boyutu |
| Web paketi (`desktop/dist`) | 3,8 MB, 321 dosya | `vite build --config vite.desktop.config.ts`, klasör boyutu |
| Temiz `target/` ile release derlemesi | 7 dk 22 sn | `tauri build --no-bundle`, Cargo'nun kendi süresi, vendored OpenSSL/SQLCipher dahil |
