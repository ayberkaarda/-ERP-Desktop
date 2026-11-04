# Keystone masaüstü performansı

Durum: **soğuk açılış ve boşta bellek taban değerleri beklemede.** Bunlar pencere açabilen bir makinede GUI koşusu ister; burada kayıtlı değer yoktur. Aşağıdakilerin hiçbiri bu sayıların tahmini değildir.

## Yöntem (bekleyen taban değer için)

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

Bilinen uyarı: betiğin önceki bir sürümüyle (`-MinProcesses` öncesi) yapılan deneme gerçekçi olmayan erken hazır süreleri verdi; çünkü webview yardımcıları başlamadan CPU sessiz görünüyordu. Depodaki sürüm bu kapıyı ekler ama yeniden koşulmadı; ilk gerçek koşuda `ready_ms` bir kronometreyle karşılaştırılmalıdır.

## Pencere açmadan ölçülenler

Makine: AMD Ryzen 5 7600 (6 çekirdek, 12 iş parçacığı), 31 GB RAM, Windows 11 Pro 10.0.26300.

| Kalem | Değer | Nasıl |
|---|---|---|
| Release ikilisi `keystone-desktop.exe` | 24,2 MB | `tauri build --no-bundle`, dosya boyutu |
| Web paketi (`desktop/dist`) | 3,8 MB, 321 dosya | `vite build --config vite.desktop.config.ts`, klasör boyutu |
| Temiz `target/` ile release derlemesi | 7 dk 22 sn | `tauri build --no-bundle`, Cargo'nun kendi süresi, vendored OpenSSL/SQLCipher dahil |
