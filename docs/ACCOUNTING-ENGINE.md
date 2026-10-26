# Muhasebe Motoru: Tek Düzen Hesap Planı (TDHP) Şablonu

Bu belge, şirket kurulurken kopyalanan Tek Düzen Hesap Planı şablonunu
(`backend/app/Modules/Accounting/Database/data/tdhp.json`) ve bu verinin hangi resmî
kaynaklara dayandığını açıklar. Veri bütünlüğü
`backend/tests/Unit/Accounting/TdhpDataTest.php` ile sınanır.

## 1. TDHP yapısı

Hesap planı, 213 sayılı Vergi Usul Kanunu'nun 175 ve mükerrer 257. maddelerine dayanılarak
yayımlanan **1 Sıra No'lu Muhasebe Sistemi Uygulama Genel Tebliği** (RG 26.12.1992,
21447 mükerrer; 01.01.1994'ten itibaren zorunlu) ekindeki "Tekdüzen Hesap Çerçevesi, Hesap
Planı ve Hesap Planı Açıklamaları" bölümüne ve sonraki değişiklik tebliğlerine dayanır.

Kodlama üç düzeylidir:

| Düzey | Kod | Örnek | Şablonda |
|---|---|---|---|
| Hesap sınıfı (ana hesap grubu) | 1 hane | `1` Dönen Varlıklar | başlık, `postable=false` |
| Hesap grubu | 2 hane | `10` Hazır Değerler | başlık, `postable=false` |
| Defter-i kebir (büyük defter) hesabı | 3 hane | `100` Kasa | `postable=true` |
| Yardımcı / alt hesap | şirket belirler | `100.01` | şablonda yok |

Hesap sınıfları: 1 Dönen Varlıklar, 2 Duran Varlıklar, 3 Kısa Vadeli Yabancı Kaynaklar,
4 Uzun Vadeli Yabancı Kaynaklar, 5 Özkaynaklar, 6 Gelir Tablosu Hesapları, 7 Maliyet
Hesapları, 8 (serbest), 9 Nazım Hesaplar, 0 (serbest).

Tebliğ kuralları (2 Sıra No'lu Tebliğ, A bölümü):

- Planda belirtilen grup ve defter-i kebir hesaplarının isim, kod ve sıralaması değiştirilemez.
- Boş 2 haneli gruplar yalnızca Bakanlıkça kullandırılır.
- Boş 3 haneli hesaplar; grubun mantığına uygun olmak, planda benzeri bulunmamak ve
  bütünlüğü bozmamak şartıyla işletmece serbestçe kullanılabilir.
- Boş 8 sınıfı yönetim muhasebesi amaçlarıyla kullanılabilir; dönem sonunda kapatılır ve mali
  tablolara aktarılmaz.

### Şablon alanları

| Alan | Anlamı |
|---|---|
| `code`, `name` | Tebliğdeki kod ve ad (Tebliğ büyük harf kullanır; şablonda Türkçe yazımla başlık biçimine çevrildi, `(-)` işaretleri korundu) |
| `parent_code` | 3 haneli için 2 haneli grup, 2 haneli için sınıf, sınıf için `null` |
| `type` | `asset`, `liability`, `equity`, `revenue`, `expense`, `cost`, `memo` |
| `normal_balance` | hesabın niteliğine göre `debit` / `credit` |
| `tdhp_group` | ilk hane (1..9) |
| `postable` | 3 haneli ana hesaplar `true`; başlıklar `false`. Şirket alt hesap açınca kayıt yapılabilirlik alt hesaba taşınır |
| `scheme` | `7A` (70-78 grupları), `7B` (79 grubu), diğerleri `null` |
| `flags.requires_party` | cari (müşteri/tedarikçi/ortak/personel) boyutu zorunlu: 120, 121, 126-128, 131-133, 135, 136, 138, 159, 179, 195, 196, 220, 221, 226, 231-233, 235, 236, 320, 321, 326, 329, 331-333, 335, 336, 340, 349, 420, 421, 426, 429, 431-433, 436, 440, 449 |
| `flags.requires_cost_center` | 7/A gider hesapları 710, 720, 730, 740, 750, 760, 770, 780 ve 7/B gider çeşitleri 790-797 |
| `flags.is_revaluable` | yabancı para ile tutulabilen parasal kalemler (kur değerlemesine girer): 100-103, 108, 110-112, 118, 120, 121, 126-128, 131-133, 136, 138, 220, 221, 226, 231-233, 236, 300, 301, 303-306, 309, 320, 321, 326, 329, 331-333, 336, 400, 401, 405, 407, 409, 420, 421, 426, 429, 431-433, 436 |
| `status` | `verified` (kaynakla birebir doğrulandı) / `needs_review` |
| `source_ref` | aşağıdaki KAYNAKLAR tablosundaki satır kimliği |

`flags` alanları Tebliğ hükmü değildir; ürün kararıdır ve şirket bazında değiştirilebilir.

### Normal bakiye kuralları ve istisnalar

- Sınıf 1-2 (varlık) borç, sınıf 3-4 (yabancı kaynak) ve 5 (özkaynak) alacak.
- Adında `(-)` bulunan düzenleyici (karşı) hesaplar ters bakiye verir:
  - Varlıklarda alacak: 103, 119, 122, 124, 129, 137, 139, 158, 199, 222, 224, 229, 237,
    239, 241, 243, 244, 246, 247, 249, 257, 268, 278, 298, 299.
  - Yabancı kaynaklarda borç: 302, 308, 322, 337, 371, 402, 408, 422, 437.
  - Özkaynaklarda borç: 501, 503, 58 grubu ve 580, 591.
- Sınıf 6: 60, 64, 67 grupları gelir (alacak); 61 Satış İndirimleri gelirden indirim
  (`type=revenue`, borç); 62, 63, 65, 66, 68 grupları gider (borç).
- 69 grubu kapanış hesaplarıdır: 690 ve 692 dönem sonucuna göre her iki yönde bakiye
  verebilir; şablon kâr yönünü (alacak) esas alır. 691 borç. 697 ve 698 enflasyon düzeltme
  hesapları da her iki yönde bakiye verebilir (şablonda alacak).
- Sınıf 7 gider hesapları borç; yansıtma hesapları (701, 711, 721, 731, 741, 751, 761,
  771, 781, 798) alacak. Fark hesapları (712, 713, 722, 723, 732-734, 742, 752, 762, 772,
  782) Tebliğe göre borç veya alacak kalıntısı verebilir; şablon borç kabul eder.
- 393 Merkez ve Şubeler Cari Hesabı borçlu ve alacaklı çalışır; şablon alacak kabul eder.

## 2. 7/A ve 7/B seçenekleri

Tebliğ maliyet hesaplarını iki seçenek halinde sunar (şirket ayarı
`accounting.expense_scheme = 7A|7B` hangi 7xx hesaplarının kopyalanacağını belirler):

- **7/A (fonksiyon esası):** Giderler defter-i kebirde fonksiyonlarına göre izlenir; gider
  çeşitleri ve gider yerleri yardımcı defterlerde tutulur. Gruplar: 70 Maliyet Muhasebesi
  Bağlantı Hesapları (yalnızca maliyet muhasebesi genel muhasebeden ayrı yürütülürse),
  71 Direkt İlkmadde ve Malzeme, 72 Direkt İşçilik, 73 Genel Üretim, 74 Hizmet Üretim
  Maliyeti, 75 Araştırma ve Geliştirme, 76 Pazarlama, Satış ve Dağıtım, 77 Genel Yönetim,
  78 Finansman Giderleri. Her grup gider (x0), yansıtma (x1) ve fark (x2-x4) hesaplarından
  oluşur. Dönem sonunda yansıtma hesapları üzerinden 15x stok, 62x maliyet ve 63x/66x
  sonuç hesaplarına aktarılır.
- **7/B (çeşit esası):** Yalnızca 79 Gider Çeşitleri grubu kullanılır (790-797 gider
  çeşitleri, 798 Gider Çeşitleri Yansıtma, 799 Üretim Maliyet). Dönem sonunda gider dağıtım
  tablosuyla 799, 630-632 ve 66 grubuna aktarılır; 798 ile 790-797 karşılaştırılarak kapatılır
  (2 Sıra No'lu Tebliğ C/29).
- **Zorunluluk:** 3 Sıra No'lu Tebliğ, önceki yıl aktif toplamı veya net satışları belirli
  tutarı aşan üretim ve hizmet işletmeleri için 7/A'yı zorunlu kılmıştır; ticaret işletmeleri
  ve sınırın altındaki üretim/hizmet işletmeleri seçim yapabilir. Tutarlar 7, 9 ve 10 Sıra
  No'lu Tebliğlerle güncellenmiş, 10 Sıra No'lu Tebliğ ile her yıl yeniden değerleme oranında
  artırılması öngörülmüştür. Güncel tutar bu belgede tutulmaz (bkz. TODO).

Not: 630-632 ve 66 grubu her iki seçenekte de gelir tablosu hesabıdır; şablonda her zaman
kopyalanır (`scheme=null`).

## 3. Hesap sayıları

Şablonda 337 kayıt vardır: 335 `verified`, 2 `needs_review`.

| Sınıf | Toplam | Başlık (1-2 hane) | Ana hesap (3 hane) | verified | needs_review |
|---|---|---|---|---|---|
| 1 Dönen Varlıklar | 56 | 9 | 47 | 56 | 0 |
| 2 Duran Varlıklar | 65 | 9 | 56 | 65 | 0 |
| 3 Kısa Vadeli Yabancı Kaynaklar | 50 | 10 | 40 | 50 | 0 |
| 4 Uzun Vadeli Yabancı Kaynaklar | 35 | 8 | 27 | 35 | 0 |
| 5 Özkaynaklar | 26 | 7 | 19 | 25 | 1 |
| 6 Gelir Tablosu Hesapları | 53 | 11 | 42 | 53 | 0 |
| 7 Maliyet Hesapları | 51 | 11 | 40 | 50 | 1 |
| 8 (serbest) | 0 | 0 | 0 | 0 | 0 |
| 9 Nazım Hesaplar | 1 | 1 | 0 | 1 | 0 |
| **Toplam** | **337** | **66** | **271** | **335** | **2** |

7 sınıfının dağılımı: sınıf başlığı 1 (`scheme=null`); 7/A 9 grup + 30 hesap = 39 kayıt;
7/B 1 grup + 10 hesap = 11 kayıt.

`needs_review` kayıtları:

- **524 Maliyet Bedeli Artışları Fonu:** 4 Sıra No'lu Tebliğ'de "Öz Kaynaklar ana hesap
  grubunun altında açılacak 524- Maliyet Bedeli Artışları Fonu hesabında izlenmektedir"
  ifadesiyle anılıyor; hesabı açan ayrı bir düzenleme metni bulunamadı.
- **798 Gider Çeşitleri Yansıtma Hesabı:** Hesap planı listesinde "Hesabı", hesap çerçevesi,
  açıklamalar ve Resmî Gazete metninde "Hesapları" olarak geçiyor.

## 4. KAYNAKLAR

Erişim tarihi: tüm satırlar için **2026-10-21**. Resmî Gazete arşiv PDF'leri birincil
kaynaktır; PDF metin katmanı taranmış/OCR kaynaklı olduğundan kod-ad eşleşmeleri İSMMMO'nun
(TÜRMOB'a bağlı İstanbul SMMM Odası) yayımladığı tam metinlerden okunmuş ve RG metniyle
karşılaştırılmıştır.

| Kimlik | Düzenleme | URL | Durum |
|---|---|---|---|
| MSUGT-1 | 1 Sıra No'lu MSUGT, RG 26.12.1992 / 21447 (mükerrer): hesap çerçevesi, hesap planı, açıklamalar | https://www.resmigazete.gov.tr/arsiv/21447_1.pdf ; https://ismmmo.org.tr/Mevzuat/1-Seri-No-lu-Muhasebe-Sistemi-Uygulama-Genel-Tebligi-26-12-1992---3997 ; https://ismmmo.org.tr/Mevzuat/A-TEK-DUZEN-HESAP-CERCEVESI--4011 ; https://ismmmo.org.tr/Mevzuat/B-HESAP-PLANI--4010 ; https://ismmmo.org.tr/Mevzuat/C-HESAP-PLANI-ACIKLAMALARI--4009 | verified: sınıf 1-7 ve 9'un tüm grup ve hesapları (798 hariç) |
| MSUGT-2 | 2 Sıra No'lu MSUGT, RG 16.12.1993 / 21790: yeni hesaplar 127, 17/170-178, 179, 190, 195, 295, 35/350-358, 393, 645, 646, 647, 655, 656; 23 grubu kod düzeltmesi; 339→336, 398→397, 439→436, 652→657; 492, 649, 659, 791, 792 ad düzeltmeleri | https://www.resmigazete.gov.tr/arsiv/21790.pdf ; https://ismmmo.org.tr/Mevzuat/2-Seri-No-lu-Muhasebe-Sistemi-Uygulama-Genel-Tebligi-16-12-1993---4053 | verified |
| MSUGT-3 | 3 Sıra No'lu MSUGT, RG 18.09.1994 / 22055: 7/A zorunluluğu ve 7/B kapsamı | https://ismmmo.org.tr/Mevzuat/3-Seri-No-lu-Muhasebe-Sistemi-Uygulama-Genel-Tebligi-18-09-1994---4055 | verified (yalnızca 2. bölüm metni; hesap eklemez) |
| MSUGT-4 | 4 Sıra No'lu MSUGT, RG 18.03.1995 / 22231: 524 hesabına atıf | https://ismmmo.org.tr/Mevzuat/4-Seri-No-lu-Muhasebe-Sistemi-Uygulama-Genel-Tebligi-18-03-1995---4057 | needs_review (524) |
| MSUGT-10 | 10 Sıra No'lu MSUGT, RG 19.12.2000 / 24265: 7/A ve ek mali tablo hadleri, yıllık artırım kuralı | https://ismmmo.org.tr/Mevzuat/10-Seri-No-lu-Muhasebe-Sistemi-Uygulama-Genel-Tebligi-19-12-2000---4069 | verified (hesap eklemez) |
| MSUGT-11 | 11 Sıra No'lu MSUGT, RG 31.07.2003 / 25185: finansal kiralama hesapları 124, 224, 301, 302, 401, 402 | https://ismmmo.org.tr/Mevzuat/11-Seri-No-lu-Muhasebe-Sistemi-Uygulama-Genel-Tebligi-31-07-2003---4071 | verified |
| MSUGT-12 | 12 Sıra No'lu MSUGT, RG 05.05.2004 / 25453: enflasyon düzeltmesi hesapları 178, 358, 502, 503, 648, 658, 697, 698 | https://ismmmo.org.tr/Mevzuat/12-Sira-No-lu-Muhasebe-Sistemi-Uygulama-Genel-Tebligi-05-05-2004---2998 | verified |
| MSUGT-5..9, 13..15 | 5-9 Sıra No (mali tablo ve haddeler), 13-14 (YTL dönüşümü, RG 25605 ve 25684), 15 (TL/Kr dönüşümü, RG 27092) | https://ismmmo.org.tr/Mevzuat/Muhasebe-Sistemi-Uygulama-Genel-Tebligleri-Tek-Duzen-Hesap-Plani---3988 | incelendi: hesap kodu/adı değişikliği yok |

Şablonda yalnızca `source_ref` olarak MSUGT-1, MSUGT-2, MSUGT-4, MSUGT-11 ve MSUGT-12
kullanılır.

### Yazım tercihleri

Tebliğ metinleri arasında küçük yazım farkları vardır; şablonda şu tercihler yapıldı:
152/620 "Mamuller" (planda "Mamüller", açıklamalarda ve RG'de "Mamuller"); 253 "Tesis,
Makine ve Cihazlar" (açıklamalarda "Makina"); 308/408 "İhraç Farkı" (açıklamalarda
"Farkları"); 520 "Hisse Senetleri İhraç Primleri" (açıklamalarda "Hisse Senedi"); 601
"Yurtdışı Satışlar"; 71x ve 790 "İlkmadde" (planın yazımı; 150 "İlk Madde"); 76 grubu
"Pazarlama, Satış ve Dağıtım" (planda "SATIŞ YE" yazım hatası); 721 "İşçilik" (planda
"İŞCİLİK"); 631 adına açıklamalardaki `(-)` eklendi.

## 5. Açık işler (TODO)

1. **8 sınıfı:** Tebliğde serbesttir, ad ve hesap yok; şablona eklenmedi. Yönetim muhasebesi
   için kullanılacaksa şirket kendisi açmalı (dönem sonunda kapanır, mali tabloya girmez).
2. **9 Nazım Hesaplar:** Tebliğde yalnızca sınıf adı var, 90-99 grupları boş. Şablonda sadece
   başlık (`postable=false`) bulunuyor; uygulamada kullanılan 900/901 vb. hesaplar resmî
   değildir ve eklenmedi. Şirketler alt hesap açmalı ya da ayrı bir karar alınmalı.
3. **170-177 ve 350-357:** Tebliğ 170-178 ve 350-358 aralıklarını proje bazında açılacak hesaplar
   olarak tanımlar. Şablonda yalnızca 170 ve 350 (aralığın adıyla) ile 178/358 (enflasyon
   düzeltme) var; diğer kodlar proje açıldıkça oluşturulmalı.
4. **524 ve 798:** `needs_review`; resmî metinden kesin ad doğrulanmalı.
5. **15 Sıra No sonrası değişiklikler:** 2009 sonrası TDHP'ye hesap ekleyen bir Muhasebe Sistemi
   Uygulama Genel Tebliği bulunamadı (BDDK'nın bankalar için ayrı TDHP tebliği kapsam
   dışıdır). VUK 555 Sıra No'lu Genel Tebliğ (2023 enflasyon düzeltmesi) ve sonrasının hesap
   planına etkisi ayrıca kontrol edilmeli.
6. **Resmî Gazete PDF karşılaştırması:** RG 21447 mükerrer PDF metin katmanı Türkçe karakterleri
   ve sütun hizasını bozuyor; kod-ad eşleşmeleri İSMMMO metninden alındı. Sayfa görüntüsü
   üzerinden satır satır karşılaştırma yapılmadı.
7. **7/A zorunluluk hadleri:** Güncel aktif toplamı / net satış tutarları (her yıl yeniden
   değerleme oranında artırılır) belgelenmedi; seçim ekranında kullanılacaksa GİB
   duyurularından alınmalı.
8. **Boş 3 haneli hesaplar** (ör. 104-107, 113-117, 123, 125): Tebliğe göre şirket serbestçe
   açabilir; şablona eklenmedi.
9. **`flags` seçimleri** (requires_party, is_revaluable) Tebliğ hükmü değildir; ürün ekibiyle
   gözden geçirilmeli (ör. 101 Alınan Çekler için cari zorunluluğu, 340 Alınan Sipariş
   Avansları için kur değerlemesi).

## 6. Raporlar (API)

Tüm uçlar `GET /api/v1/reports/...` altındadır, `accounting.reports.view` izni ister (varsayılan
roller: Accountant, Viewer) ve yalnızca etkin şirketin verisini okur. İzin, doğrulamadan önce
denetlenir (izinsiz çağrı her zaman 403). Hatalı parametreler standart `VALIDATION_ERROR`
zarfıyla 422 döner. Tutarlar her zaman dört ondalıklı metindir (`"1250.0000"`).

**Aralık:** `period_id` ya da kapsayıcı `date_from` + `date_to` (Y-m-d); ikisi birlikte verilemez.
Dönem isteğinde o döneme kaydedilmiş fişler sayılır, açılış ondan önceki dönemlerdir (13. düzeltme
dönemi 12. dönemden ayrı tutulur). Tarih isteğinde açılış `date_from` öncesindeki tüm kayıtlardır.

**Sayılan fişler:** `posted` ve `reversed` durumundakiler (ters kayıt ayrı bir fiş olduğundan
orijinal fiş geçmişte kalır, iki fiş birbirini sıfırlar). Taslaklar hiçbir raporda yer almaz.

**Veri kaynağı:** Hiçbir dönemi bölmeyen tarih aralıkları ve dönem istekleri `account_balances`
tablosundan, diğerleri `journal_lines` üzerinden hesaplanır; yanıttaki `source` alanı
(`balances` | `lines`) hangisinin kullanıldığını gösterir. Testler iki kaynağın aynı sonucu
verdiğini doğrular. Her rapor tek bir `REPEATABLE READ, READ ONLY` işlem içinde okunur.

| Uç | İçerik | Parametreler |
|---|---|---|
| `trial-balance` (mizan) | Hesap kodu sırasıyla satırlar; üst hesaplar alt hesapların toplamını taşır. Her satırda `opening_debit/credit` (devir), `debit/credit` (dönem hareketi), `total_debit/credit` (kümülatif), `balance_debit/credit`. `groups`: TDHP sınıfı (1-9) ara toplamları; `totals` (bakiye sütunları hesap bazında ayrı toplanır, karşı bakiyeler birbirini silmez), `balanced` (borç = alacak) ve `difference`. | `level` (1..n, boşsa tüm seviyeler), `include_zero`, `compare_with_previous_year` (bir gün önce biten mali yılın aynı numaralı dönemi, o yıl yoksa bir yıl geri kaydırılmış tarihler; satırlarda `previous`, ayrıca `previous_totals`) |
| `general-ledger` (büyük defter) | Tarih ve fiş numarasına göre satırlar, sayfalar arasında süren `running_balance` (borç pozitif). `meta`: hesap, `opening_balance`, `totals`, `closing_balance`. Üst hesap seçilirse alt hesapların satırları gelir. | `account_id`, `page`, `per_page` (en çok 500) |
| `journal-book` (yevmiye defteri) | Mali yıl ve fiş numarası sırasıyla fişler ve satırları, fiş bazında sayfalı. `meta.carried_forward`: aynı mali yılda aralıktan önceki toplam; `page_brought_forward` (devreden), `page_totals`, `page_carried_forward` (nakledilen), `range_totals`. | `page`, `per_page` |
| `account-statement` (cari ekstre tabanı) | Cariye bağlı satırlar, açılış ve yürüyen bakiye. `account_balances` cari boyutu taşımadığından her zaman satırlardan okunur. | `party_id`, `account_from`, `account_to` (`account_to` alt hesapları kapsar: 120 → 120.01), `page`, `per_page` |

**Dışa aktarma:** Her raporun `/export?format=csv|xlsx` ucu vardır (varsayılan CSV, UTF-8 BOM).
Sayfalama yoktur; aralığın tamamı yazılır. Satır sınırı `accounting.export_max_rows` (50.000);
aşılırsa 422. XLSX hücreleri metin olarak yazılır (tutarlar kayan noktaya çevrilmez). Hücre `=`, `+`, `-`, `@`, sekme veya satır sonuyla başlıyorsa başına `'` eklenir;
yalnızca sayı olan değerler (ör. `-3000.0000`) olduğu gibi kalır. Mizan dosyasının sonunda toplam
satırı; büyük defter ve ekstrede başta açılış, sonda toplam satırı; yevmiye defterinde başta
devreden, sonda toplam satırı bulunur.
