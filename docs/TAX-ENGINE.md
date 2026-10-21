# Vergi kodları ve yuvarlama

Reference modülü vergi hesaplama motorunun ana verisini sağlar. tax_codes tablosunda company_id = null genel kayıtları, şirket UUID’si ise şirkete özel kodları belirtir. Genel kayıtlar API üzerinden değiştirilemez ve silinemez (politika ve yazma servisi ikisi de reddeder); yalnızca seeder ile bakımı yapılır. Şirket, tax_codes.create izniyle aynı kod için kendi kaydını oluşturabilir; tarihte geçerli şirket kaydı genel kayıttan önce seçilir. Başka şirketin özel kodları listede, detayda, güncellemede ve TaxCodeLookup’ta görünmez.

Türler: vat, withholding, excise, exemption, other. rate yüzde cinsinden numeric(7,4) ve JSON string değeridir. Tevkifat payı numerator/denominator olarak tutulur; pay pozitif ve paydayı aşamaz. effective_from ve effective_to dahil sınırlardır.

## Doğrulama durumu

Seed kayıtlarının meta alanı: status (verified | needs_review), source_url, retrieved_at, effective_period_verified, note. status = verified yalnızca değer birincil kaynaktan (GİB, Resmî Gazete, mevzuat.gov.tr) okunduğunda verilir. effective_period_verified = false olan kayıtlarda kod/oran doğrulanmış, başlangıç tarihi doğrulanmamıştır.

Özet (2026-10-21): 6 seed kaydından 5’i verified, 1’i needs_review (VAT0).

- KDV oranları: GİB’in güncel “Mal ve Hizmetlere Uygulanacak KDV Oranlarının Tespitine İlişkin Karar (2007/13033)” metninin 1. maddesine göre genel oran %20 ve (II) sayılı liste %10’dur; ikisi de 7346 sayılı Cumhurbaşkanı Kararı ile değişmiş ve 10/07/2023’te yürürlüğe girmiştir (RG 07.07.2023, sayı 32241). (I) sayılı liste için %1 oranında değişiklik notu yoktur; Kararın diğer hükümleri yayımını izleyen gün (31/12/2007) yürürlüğe girdiğinden VAT1 başlangıcı 2007-12-31 alınmıştır. GİB metnindeki son işlenmiş değişiklik 9126 sayılı Karardır (yürürlük 15/11/2024); sonrasında genel oranı değiştiren bir karar bulunamamıştır.
- VAT0: %0 Kararda bir oran değildir. Sıfır KDV yalnızca bir istisna koduyla (ör. 301) birlikte oluşur; bu yüzden needs_review olarak bırakılmıştır.
- 301: GİB UBL-TR Kod Listeleri V1.43 (Temmuz 2026) “Tam İstisna Kodları Listesi”nde 301 = “11/1-a Mal İhracatı”. Dayanak 3065 sayılı KDV Kanunu 11/1-a (mevcut metin 5766 sayılı Kanunla değişik). Seed başlangıç tarihi (2023-07-10) yasal tarih değildir.
- 601: UBL-TR Kod Listeleri V1.43 “Tevkifat Kodları Listesi”nde 601 = Yapım işleri ile bu işlerle birlikte ifa edilen mühendislik-mimarlık ve etüt-proje hizmetleri, oran 4/10. KDV Genel Uygulama Tebliği I/C-2.1.3.2.1.1: (I/C-2.1.3.1/b) alıcılara yapılan yapım işlerinde ve (I/C-2.1.3.1/a) alıcılara yapılan KDV dahil bedeli 5 milyon TL ve üzeri yapım işlerinde 4/10. Bölüm 35 Seri No.lu Tebliğ ile değişmiş, yürürlük 1/3/2021 (güncel metin dipnot 38). Alıcı sınıfı ve tutar eşiği belge motorunda ayrıca kontrol edilmelidir.

## ÖTV yapısı

ÖTV tek bir genel orana sahip değildir; oranlar 4760 sayılı Kanunun eki listelere, ürüne ve matraha göre değişir. Bu yüzden ÖTV oranı seed edilmemiştir. UBL-TR Kod Listeleri V1.43 “Vergi Kodları Listesi”nde ÖTV kodları: 0071 ÖTV 1. liste (petrol ve doğalgaz ürünleri), 9077 ÖTV 2. liste (tescile tabi motorlu taşıtlar), 0073 ÖTV 3. liste (kolalı gazoz, alkollü içecek, tütün mamulleri), 0074 ÖTV 4. liste (dayanıklı tüketim ve diğer mallar), 0075 ÖTV 3A (alkollü içecekler), 0076 ÖTV 3B (tütün mamulleri), 0077 ÖTV 3C (kolalı gazozlar), 4171 petrol ve doğalgaz ürünlerine ilişkin ÖTV tevkifatı. Ürün bazlı ÖTV tutarları Catalog/satış modüllerinde, ürün ve liste bilgisiyle tanımlanmalıdır.

## TCMB kur dosyası

https://www.tcmb.gov.tr/kurlar/today.xml (ve /kurlar/YYYYMM/DDMMYYYY.xml) yapısı 2026-10-21’de canlı dosya ile karşılaştırıldı: XML bildirimi, isokur.xsl stylesheet işleme talimatı, kök Tarih_Date (Tarih=“dd.mm.yyyy”, Date, Bulten_No), her para birimi için Currency (CrossOrder, Kod, CurrencyCode) altında Unit, Isim, CurrencyName, ForexBuying, ForexSelling, BanknoteBuying, BanknoteSelling, CrossRateUSD, CrossRateOther. JPY Unit=100 ile yayımlanır; KRW, KZT, AZN, AED gibi bazı kurlarda banknot alanları boştur; KRW/KZT 5 ondalıkla verilir; XDR (SDR) yalnızca ForexBuying ile yayımlanır ve içe aktarımda atlanır. Dosyada DOCTYPE yoktur. Test fixture’ı bu yapıyı kurgusal değerlerle taklit eder; canlı veri depoya eklenmemiştir.

Parser DOCTYPE/ENTITY bildirimlerini ve NUL baytını reddeder, LIBXML_NONET kullanır ve 1 MB sınırı uygular. HTTP isteği yalnız https://www.tcmb.gov.tr hostuna, 10 saniye timeout ile ve yönlendirme izlenmeden yapılır; Content-Length ve indirme ilerlemesi 1 MB ile sınırlıdır.

## Yuvarlama politikası

Otorite App\Core\Money\RoundingPolicy sınıfıdır: HalfUp, tutar ölçeği 4, fiyat/miktar/kur ölçeği 6, para birimi alt birimine göre belge satırı/vergi yuvarlaması. Sabit currency() yardımcısı 2 basamak kullanır; JPY/KWD gibi para birimlerinde round(value, currencyDecimals) seçilmelidir. Hesaplar BigDecimal ile yapılır; float kullanılmaz. Satır vergisi matrah × oran / 100 olarak hesaplanıp para birimi ölçeğine yuvarlanır; belge vergisi yuvarlanmış satır vergilerinin toplamıdır. Kuruş dağıtımı gerektiğinde allocate() toplamı koruyan en büyük kalan yöntemini uygular. Reference modülü bu fazda belge vergisi hesaplamaz.

Kur sütunları numeric(20,6) ve JSON string değeridir. TCMB Unit alanı başına verilen değerler bir birime bölünür ve 6 basamak HalfUp yuvarlanır. TCMB kurları geneldir (company_id = null, source = tcmb) ve yalnızca rates:fetch-tcmb / rates:backfill komutlarıyla yazılır; günlük tekillik (currency_code, rate_date). Manuel kurlar şirkete aittir (company_id dolu, source = manual), exchange_rates.manage izniyle yalnızca aktif şirket için POST /exchange-rates ile oluşturulur; tekillik (company_id, currency_code, rate_date). Bir CHECK kısıtı kaynak ile sahipliği eşler. /exchange-rates listesi ve /latest genel TCMB kayıtlarını ve yalnızca aktif şirketin manuel kayıtlarını döndürür; başka şirketin manuel kuru görünmez ve hesaplamada kullanılmaz. ExchangeRateProvider döviz satış kurunu kullanır ve 7 günlük geri gidişte her tarih için önce aktif şirketin manuel kurunu, yoksa TCMB kurunu arar; yani en yakın tarihli kur kazanır, manuel öncelik yalnızca aynı tarih içinde geçerlidir (daha eski bir manuel kur daha yeni bir TCMB kurunu geçmez). Çapraz kur TRY(from) / TRY(to) formülüyle, iki bacağı aynı güne ait olacak şekilde hesaplanır. En fazla 7 takvim günü geriye gidilir. Aynı para birimi için oran 1’dir.

## SOURCES

Erişim tarihi: **2026-10-21**.

| Seed kodu | Değer | Başlangıç | Kaynak URL | Erişim tarihi | Durum |
|---|---|---|---|---|---|
| VAT1 | KDV %1 | 2007-12-31 | https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=arsiv%2Fyardim-kaynaklar%2Fyararli-bilgiler%2Fkdv-oranlari.pdf | 2026-10-21 | verified |
| VAT10 | KDV %10 | 2023-07-10 | aynı GİB dosyası; https://www.resmigazete.gov.tr/eskiler/2023/07/20230707.htm (Karar 7346) | 2026-10-21 | verified |
| VAT20 | KDV %20 | 2023-07-10 | aynı GİB dosyası; https://www.resmigazete.gov.tr/eskiler/2023/07/20230707.htm (Karar 7346) | 2026-10-21 | verified |
| VAT0 | KDV %0 (teknik) | 2023-07-10 | aynı GİB dosyası (oran olarak yer almaz) | 2026-10-21 | needs_review |
| 301 | Tam istisna, 11/1-a Mal ihracatı, oran null | 2023-07-10 (yer tutucu) | https://ebelge.gib.gov.tr/dosyalar/kilavuzlar/UBLTR_1.2.1_Kilavuzlar.zip (UBL-TR Kod Listeleri V1.43); https://www.mevzuat.gov.tr/MevzuatMetin/1.5.3065.pdf | 2026-10-21 | verified (dönem doğrulanmadı) |
| 601 | Tevkifat 4/10, yapım işleri | 2021-03-01 | https://ebelge.gib.gov.tr/dosyalar/kilavuzlar/UBLTR_1.2.1_Kilavuzlar.zip; https://cdn.gib.gov.tr/api/gibportal-file/file/getFile?objectKey=MEVZUAT_TEBLIGLER%2FUNIVERSAL%2F2026%2Fkdv_genteb.pdf | 2026-10-21 | verified |
| TCMB | today.xml yapısı | — | https://www.tcmb.gov.tr/kurlar/today.xml | 2026-10-21 | verified (yapı) |

## TODO

- %18 ve %8 tarihsel oranları (10/07/2023 öncesi) eklenmedi; GİB metni eski değerleri göstermiyor, Karar 7346’nın taranmış metni okunamadı.
- 301 için yasal başlangıç tarihi doğrulanmadı.
- Diğer tam/kısmi istisna kodları (302 vb.) ile 602–627 ve 801–8xx tevkifat kodları UBL-TR V1.43 listesinde mevcut, ancak her birinin oran değişiklik tarihleri doğrulanmadığı için seed edilmedi.
