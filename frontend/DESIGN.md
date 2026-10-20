# Keystone tasarım sistemi

Keystone, Türkiye pazarına yönelik, çok şirketli bir ERP. Kullanıcı gününü yoğun tablolarda, uzun formlarda ve raporlarda geçirir. Bu yüzden kimlik gösterişten çok **güven, okunabilirlik ve yoğunluk** üzerine kurulur. Bu belge kimliğin neden böyle olduğunu ve uyulması gereken kuralları anlatır. Token'ların tek kaynağı `src/styles/tokens.css` dosyasıdır.

## 1. Kavram: kilit taşı

Kemerin tepesindeki kama biçimli taşa kilit taşı denir. Diğer bütün taşları yerinde tutan odur; o çıkarsa kemer çöker. Keystone da şirketin muhasebe, stok, satış ve finans kayıtlarını tek, tutarlı bir kayıt sisteminde birbirine kilitler.

- **İşaret (mark):** İki ayaklı bir kemer ve tepede, kemerden sabit bir derzle ayrılmış, dışa taşan bir kilit taşı. Kemer **Petrol**, kilit taşı **Okra** renktedir.
- **Logotip (wordmark):** Küçük harfli, tek kalınlıkta çizilmiş geometrik `keystone`. Harfler font dosyasından değil, çizgiden oluşur. Böylece her ortamda aynı görünür ve font yüklenmesine bağlı değildir. `n` harfindeki kemer, işaretteki kemerle aynı dili konuşur.
- **Hata görseli:** Kilit taşı düşmüş bir kemer (`ErrorState`). Boş ve hata durumlarında aynı metafor kullanılır.

### Dosyalar

| Dosya                                                 | Kullanım                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------- |
| `src/assets/brand/keystone-logo-{light,dark}.svg`     | İşaret + logotip, açık/koyu zemin                                     |
| `src/assets/brand/keystone-mark-{light,dark}.svg`     | Yalnızca işaret (avatar, küçük alan)                                  |
| `src/assets/brand/keystone-wordmark-{light,dark}.svg` | Yalnızca logotip                                                      |
| `public/favicon.svg`                                  | Karo içinde işaret; `prefers-color-scheme` ile renk değiştirir        |
| `src/components/brand/Logo.tsx`                       | Uygulama içi `KeystoneLogo` / `KeystoneMark`; renkler token'dan gelir |

Geometri dört yerde aynıdır (SVG dosyaları, favicon, `Logo.tsx`). Biri değişirse hepsi birlikte değişir.

### Logo kuralları

- Logonun çevresinde en az işaret yüksekliğinin yarısı kadar boşluk bırakılır.
- En küçük boyut: işaret 16 px, tam logo 24 px yükseklik.
- Kilit taşı her zaman Okra'dır; kemer Petrol ya da zemine göre açık Petrol (`sidebar-brand`) olur. Tek renkli baskıda ikisi de `currentColor` olabilir.
- Logo döndürülmez, gölgelenmez, gradyanla doldurulmaz, harfleri yeniden aralanmaz.

## 2. Renk

Bütün renkler OKLCH ile tanımlanır. Böylece açık ve koyu temalar arasında algısal parlaklık dengeli kalır. Bileşenler hiçbir zaman ham renk yazmaz; her zaman semantik token kullanır (`bg-surface`, `text-muted-foreground`, `bg-primary` gibi).

### Marka

| Token                 | Açık                              | Koyu                            | Anlam                                            |
| --------------------- | --------------------------------- | ------------------------------- | ------------------------------------------------ |
| `primary` (Petrol)    | `oklch(0.47 0.085 212)` ≈ #006776 | `oklch(0.73 0.1 205)` ≈ #4CBAC6 | Birincil eylem, seçili durum, odak               |
| `brand-accent` (Okra) | `oklch(0.74 0.135 78)` ≈ #D99F36  | `oklch(0.8 0.13 80)` ≈ #E9B452  | Kilit taşı, aktif menü çizgisi, 2. grafik serisi |
| `sidebar` (Mürekkep)  | `oklch(0.215 0.026 222)`          | `oklch(0.14 0.012 225)`         | Gezinme rayı; iki temada da koyu kalır           |

**Neden Petrol?** Mavi, ERP'lerde kalabalık bir alan. Yeşile yakın derin bir petrol tonu hem güven verir hem ayırt edilir. Hem açık hem koyu zeminde AA kontrastı sağlar.

**Neden Okra?** Anadolu taşının ve kum taşının sıcaklığını taşır. Soğuk Petrol'ü dengeler. Okra **asla durum rengi değildir**: uyarı için `warning` kullanılır. Okra büyük yüzeylere de uygulanmaz.

### Yüzeyler (kireçtaşı nötrleri)

`background` → `surface-sunken` → `surface` → `surface-raised` sırası derinliği verir. Açık temada nötrler hafif sıcaktır (ton 85). Koyu temada hafif soğuk mürekkep tonudur (ton 225). Metin için üç kademe vardır: `foreground`, `muted-foreground` (ikincil) ve `subtle-foreground` (yer tutucu, dipnot).

### Durum renkleri

`success`, `warning`, `danger`, `info`. Her birinin `*-soft` (zemin) ve `*-soft-foreground` (zemin üstü metin) çifti vardır. Rozetler ve satır içi uyarılar soft çiftini kullanır. Dolu `danger` yalnızca yıkıcı eylem düğmesinde kullanılır. Durum hiçbir zaman yalnızca renkle anlatılmaz: her zaman metin ya da ikonla birlikte verilir.

### Grafik paleti

`chart-1` … `chart-6` sırası sabittir: Petrol, Okra, Arduvaz mavisi, Adaçayı, Kil, Erik. Tek seriyle çizilen grafik `chart-1` kullanır. Seri sayısı altıyı geçiyorsa grafik yeniden düşünülür. Izgara için `chart-grid` kullanılır. Recharts SVG öznitelikleri `var()` çözemez; bu yüzden değerler `useChartTheme()` ile okunur ve tema değişince kendiliğinden yenilenir.

## 3. Tipografi

- **Arayüz:** IBM Plex Sans Variable (`@fontsource-variable/ibm-plex-sans`, ağırlık ekseni 100–700). Türkçe karakterlerin tamamı (ç, ğ, ı, İ, ö, ş, ü) `latin-ext` alt kümesinde bulunur. Font kendi sunucumuzdan yüklenir; Google Fonts'a istek gitmez. Plex'in açık harf biçimleri yoğun tablolarda `I/l/1` karışmasını önler.
- **Kod ve kimlikler:** IBM Plex Mono 400/500. Belge numarası, hesap kodu, VKN, IBAN ve uç nokta yazılırken `font-code` yardımcısı kullanılır.
- **Rakamlar:** `body` üzerinde `tabular-nums` açıktır. Tutarlar, miktarlar ve tarihler sütunlarda hizalı durur.

| Token        | Boyut / satır | Kullanım                            |
| ------------ | ------------- | ----------------------------------- |
| `text-2xs`   | 11/16         | Menü başlığı, rozet                 |
| `text-xs`    | 12/16         | Etiket, yardım metni, grafik ekseni |
| `text-table` | 13/18         | Tablo hücresi                       |
| `text-sm`    | 14/20         | **Gövde varsayılanı**               |
| `text-base`  | 16/24         | Uzun okuma metni                    |
| `text-lg`    | 18/26         | Kart ya da diyalog başlığı          |
| `text-xl`    | 22/30         | Sayfa başlığı, KPI değeri           |
| `text-2xl`   | 28/36         | Giriş ekranı başlığı                |

Ağırlıklar yalnızca 400 (gövde), 500 (etiket, menü) ve 600 (başlık) olur. Büyük başlıklarda harf aralığı hafifçe daraltılır (−0.01em ile −0.02em). Büyük harfli küçük etiketlerde aralık açılır. Türkçe büyük harf dönüşümü için CSS `uppercase` kullanılır; `<html lang>` doğru olduğu sürece tarayıcı i/İ dönüşümünü doğru yapar.

## 4. Aralık, ölçü, köşe, yükseklik

- **Temel birim:** 4 px (`--spacing: 0.25rem`). Kart içi boşluk 20 px, sayfa kenarı 24 px, bloklar arası 16 px.
- **Kontrol yükseklikleri:** `h-control-sm` 28 px, `h-control` 36 px (varsayılan), `h-control-lg` 44 px. Aynı satırdaki düğme, giriş alanı ve seçim kutusu aynı yükseklikte olur.
- **Tablo satırı:** `h-row` 36 px, sıkışık görünüm `h-row-compact` 32 px.
- **Kabuk:** üst bar `h-topbar` 52 px, kenar menü `w-sidebar` 240 px (daraltılmış hâli 64 px).
- **Köşe yarıçapı:** `xs` 2, `sm` 4 (rozet, menü öğesi), `md` 6 (kontroller), `lg` 8 (kart, diyalog), `xl` 12 (yalnızca pazarlama yüzeyleri). Tam yuvarlak yalnızca avatar ve durum noktasında kullanılır.
- **Yükseklik (gölge):** `shadow-xs` (kontrol, kart), `shadow-sm`, `shadow-md` (açılır menü, seçim listesi), `shadow-lg` (diyalog, bildirim). Koyu temada gölgeler zayıf kalır; derinliği kenarlık ve yüzey kademesi verir. Kart üstüne kart, gölge üstüne gölge konmaz.

## 5. Bileşen kuralları

- Primitive'ler `src/components/ui` altındadır. Radix tabanlıdır, shadcn düzenini izler ve repoda bizim kodumuzdur. Yeni varyant gerektiğinde `cva` tanımı genişletilir; özellik içinde stil kopyalanmaz.
- Her sayfada en fazla bir **primary** düğme bulunur. Diğer eylemler `secondary` ya da `ghost` olur. Yıkıcı eylem `danger` kullanır ve onay ister.
- Formlarda etiket alanın üstünde durur. Hata mesajı alanın altında `text-danger` ile gösterilir. Alan `aria-invalid` ve `aria-describedby` taşır. Doğrulama zod şemasıyla yapılır; şemadaki mesajlar i18n anahtarıdır.
- Boş, yükleniyor ve hata durumları her ekranda tasarlanır. Yükleniyor için `Skeleton` kullanılır, dönen ikon yalnızca düğme içinde yer alır.
- Odak halkası her zaman görünür: 2 px, `ring` rengi. Hiçbir bileşen `outline: none` ile bırakılmaz.
- Metinler sabit yazılmaz; hepsi `src/lib/i18n/locales/*.json` dosyalarından gelir. Kaynak dil Türkçedir. `npm run i18n:check`, dört dilin anahtar ve yer tutucu eşitliğini denetler.
- Para tutarı `decimal.js` ile tutulur ve `formatMoney` ile gösterilir. JavaScript `number` ile para hesabı yapılmaz.

## 6. Tema

Tema seçenekleri: Açık, Koyu ve Sistem (varsayılan). Seçim `useThemeStore` içinde saklanır (`keystone.theme`). `index.html` içindeki küçük betik ilk boyamadan önce `.dark` sınıfını uygular, böylece tema açılışta yanıp sönmez. Koyu tema bir renk tersine çevirme değildir: her token iki tema için ayrı ayarlanmıştır. Kenar menü iki temada da koyudur; bu, düzenin sabit çapasıdır.

## 7. Hareket ve efektler

Hareket bilgi taşır, süs olarak eklenmez. Bütün hareket **yalnızca CSS ve SVG** ile yapılır.

- Yalnızca `transform` ve `opacity` canlandırılır. Süreler kısa tutulur: 120 ms (hover), 180 ms (açılır menü, diyalog), 320 ms (sayfa düzeyi). Eğri olarak `ease-standard` kullanılır.
- Tema geçişi tarayıcı destekliyorsa **View Transitions** ile yumuşak bir çapraz geçiştir.
- Giriş ekranındaki arka plan, `@property --ks-angle` ile çok yavaş dönen bir konik gradyan ve üzerinde statik SVG kemerlerden oluşur. **Statik SVG/CSS her zaman birincil tasarımdır**; hareket yalnızca bir katmandır.
- `prefers-reduced-motion: reduce` açıksa bütün animasyon ve geçişler fiilen kapanır.
- `effects` tercihi (`off` / `auto` / `on`, varsayılan `auto`) `useThemeStore` içinde tutulur ve `<html data-effects>` özniteliğine yansır. `off` dekoratif hareketi kapatır. `auto`, sistem tercihine ve cihaz kapasitesine uyar. Şimdilik yalnızca yer tutucudur; ayarlar ekranı geldiğinde kullanıcıya açılacak.
- **WebGL kuralları:** Faz 0'da three.js, react-three-fiber, drei ya da başka bir WebGL bağımlılığı eklenmez. İleride giriş ekranına isteğe bağlı bir efekt eklenebilir. Bu efekt şu koşullara uyar:
  - Tembel yüklenen ayrı bir parça olur (OGL, three'ye tercih edilir), boyutu en fazla 150 KB gzip'tir.
  - Kare döngüsü yalnızca gerektiğinde çalışır (on demand).
  - `effects` ayarına uyar.
  - Yüklenemezse statik SVG/CSS tasarım aynen kalır.
- WebGL **asla** tablolarda, formlarda, raporlarda, baskı görünümlerinde ve canlı güncellenen ekranlarda kullanılmaz. 3B depo görünümü Stok (Inventory) fazına ayrılmıştır.

## 8. Yoğunluk ve düzen

- İçerik genişliği panolarda 1440 px, form ve detay sayfalarında 768 px ile sınırlanır.
- Tablo hücresinde sayılar sağa, metin sola hizalanır. Para birimi sembolü tutarla aynı hücrede yer alır.
- Sayfa başlığı (`PageHeader`) solda başlık ve açıklamadan, sağda eylemlerden oluşur. Sayfa başına tek başlık seviyesi (`h1`) kullanılır.
- Gezinmedeki "Yakında" öğeleri sonraki fazlardaki modülleri gösterir. Tıklanamazlar ve `aria-disabled` taşırlar.
