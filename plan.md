# Keystone ERP — Web Planı (`C:\dev\-ERP`)

> Üst seviye referans. Faz ve görev ayrıntıları Faz 0'da `docs/ROADMAP.md`'ye açılır, canlı durum `docs/PROGRESS.md`'de tutulur.

## Context

Kullanıcı Türkiye öncelikli, çok şirketli, **tam kapsamlı** ve mühendislik seviyesinde bir ERP istiyor. Önce web (`C:\dev\-ERP`), ardından Syncra-CRM-Desktop'taki gibi ayrı repoda bir masaüstü uygulaması (`C:\dev\-ERP-Desktop`).

İçinde LLM bağlanabilen bir asistan katmanı hazır olacak ama **varsayılan kapalı** gelecek. Biz LLM bağlamıyoruz; isteyen `.env`'e sağlayıcı ve API anahtarı yazıp açar.

Tech stack, kullanıcının repolarıyla aynı aileden olacak: `ayberkaarda/Syncra-CRM` (yerelde `C:\dev\SIGMA-CRM`, Laravel + React) ve `Syncra-CRM-Desktop` (yerelde `C:\dev\SIGMA-CRM-Desktop`, Tauri 2 + Rust).

**Korunacak CRM güçlü yanları:**
- tek hata zarfı
- her uçta Policy ve IDOR kontrolleri
- row lock + `version` ile eşzamanlılık
- broadcast'in commit sonrası yapılması
- güvenlik test seti
- Türkçe dokümantasyon disiplini
- masaüstünde SQLCipher, outbox ve Conflict Inbox, "sessiz üzerine yazma yasak" ilkesi, üç dilde wire-fixture sözleşme testleri

**Kapatılacak CRM açıkları:**
- *Altyapı:* CI ve Docker yok, Windows/XAMPP bağımlılığı var.
- *Backend kalitesi:* statik analiz, strict_types, Enum ve DTO yok. API versiyonsuz, OpenAPI yok.
- *Frontend:* test, form ve schema kütüphanesi yok. Kod tekrarı ve yorum gürültüsü fazla.
- *Ürün:* çok şirket desteği yok.
- *Masaüstü:*
  - Masaüstü reposu web reposunun **kopyası** ve ayrışmış durumda: frontend'de 89, backend'de 55 dosya farklı. Sync API yalnızca bu kopyada var.
  - Senkron her yazmayı tek bir global sayaç satırında sıraya sokuyor.
  - Token webview JS'ine açık.
  - Sunucu adresi ve Reverb anahtarı derleme anında gömülü.
  - 22 elle kopyalanmış mirror tablo var.
  - Tipler elle yazılıp regex script'leriyle kontrol ediliyor.

**Kullanıcı kararları:**
- güncel sürümler (PHP 8.4 / Laravel 13 / React 19)
- PostgreSQL 18
- Türkiye öncelikli yerelleştirme
- çok şirketli tek kurulum (kapalı devre, public kayıt yok)
- masaüstü **ayrı repo** (CRM gibi)
- çevrimdışı kapsam: **okuma + taslak**
- isim: **Keystone**, yani kemerin ortasındaki kilit taşı; işletmeyi bir arada tutan parça. Kimlikler: `APP_NAME=Keystone`, DB `keystone`, `com.keystone.desktop`, deep-link `keystone://`, Rust crate `keystone-sync`. İsim tek config noktasından yönetilir.

---

# BÖLÜM A — WEB (`C:\dev\-ERP`)

## A1. Tech stack (CRM'e göre farklar kalın)

| Katman | Seçim | CRM'de |
|---|---|---|
| Backend | **PHP 8.4**, **Laravel 13.x** | PHP 8.2, Laravel 12 |
| Auth | Sanctum 4 (SPA cookie) + **TOTP 2FA** + **cihaz/entegrasyon token'ı** | yalnızca cookie |
| RBAC | spatie/laravel-permission **8.x, `teams` = şirket** | 6.x |
| Audit | spatie/laravel-activitylog **5.x** | 4.x |
| Realtime | Laravel Reverb 1.12 + laravel-echo + pusher-js | aynı |
| Queue/Cache | Redis 8 (**Docker**) + **Horizon**, çoklu kuyruk (default, documents, edocs, reports, imports, assistant) | Redis (WSL) + predis |
| DB | **PostgreSQL 18**: `uuidv7()`, `pg_trgm`, deferred constraint trigger, `xid8` | MariaDB 10.4 |
| Para | **brick/money + brick/math**, `numeric(20,4)` | bcmath, `decimal(15,2)` |
| Export/PDF/Sanitize | maatwebsite/excel 3.1, laravel-dompdf 3.1 (DejaVu Sans), htmlpurifier | aynı |
| Liste sorguları | **spatie/laravel-query-builder** + ortak `ListQuery`, `pg_trgm` arama | elle, `LIKE` |
| API sözleşmesi | **dedoc/scramble** (OpenAPI 3.1) → **openapi-typescript** | yok |
| LLM | **laravel/ai 1.x** (resmî SDK), varsayılan kapalı | yok |
| Test/Kalite (BE) | **Pest 5** + arch testleri, **Larastan seviye 8+**, Pint, `strict_types`, Enum, readonly DTO | PHPUnit, Pint |
| Frontend | **React 19.3**, Vite 8, **TypeScript 6.0.x**, **React Router 8**, TanStack Query 5, Zustand 5, axios | React 18, RR 7 |
| UI | Tailwind 4.3 (`@theme` token'ları), **shadcn/ui (Radix) repo içinde**, lucide-react, sonner, @dnd-kit, Recharts 3 | elle yazılmış primitive'ler |
| Form/Tablo/Sayı | **react-hook-form + zod**, **TanStack Table + Virtual**, **decimal.js** | yok |
| i18n | i18next + react-i18next, tr/en/de/fr + anahtar eşitliği kontrolü | aynı |
| Test (FE) | **Vitest + Testing Library + MSW**, **Playwright** e2e | yok |
| Altyapı | **docker-compose** (postgres:18, redis:8, mailpit, minio), **GitHub Actions** | yok |

**Sürüm notları:**
- TypeScript 7 bilinçli olarak kullanılmıyor, çünkü typescript-eslint şu an `<6.1` destekliyor.
- PHP 8.4 Windows'a **Laravel Herd** ile kurulur. Yedek yol `winget install PHP.PHP.8.4`. Gereken eklentiler: `pdo_pgsql`, `intl`, `zip`, `bcmath`, `gd`.
- CRM'deki gibi bir `dev.bat` olacak: Docker servislerini, API'yi, Reverb'ü, Horizon'u, scheduler'ı ve Vite'ı başlatır. Yanında çapraz platform bir `composer dev` de olacak.
- Scramble ve shadcn'in Laravel 13 / React 19 / Tailwind 4.3 uyumu Faz 0'da gerçek kurulumla doğrulanır. Uyumsuzluk çıkarsa alternatif bir ADR'ye yazılır.

## A2. Repo yapısı

```
backend/            Laravel 13 REST API (/api/v1)
frontend/           React 19 SPA (masaüstü bunu aynen paylaşacak)
contracts/          sync wire JSON Schema'ları + offline-manifest + wire-fixtures (masaüstü fazında dolar)
docs/               ROADMAP, PROGRESS, ENGINEERING-RULES, ARCHITECTURE, DATABASE, AUTH-FLOWS,
                    DESIGN-SYSTEM, ACCOUNTING-ENGINE, TAX-ENGINE, E-DOCUMENTS, PAYROLL,
                    ASSISTANT, SYNC-PROTOCOL, adr/NNNN-*.md
docker-compose.yml  package.json (npm workspaces: frontend)  dev.bat  plan.md  README.md/README.tr.md
.github/workflows/  backend.yml  frontend.yml  e2e.yml  openapi-drift.yml
```

### Backend: modüler monolit
CRM'deki `Controller → Service → Repository` katmanlaması korunur, ama organizasyon modül bazlı olur:

```
app/Core/
  Company/      CompanyContext, BelongsToCompany scope, ResolveCompany middleware (X-Company-Id)
  Money/        Money/Decimal cast'leri, RoundingPolicy, CurrencyConverter
  Numbering/    NumberSequenceService (boşluksuz, row lock)
  Documents/    DocumentStatus contract, StateMachine, HasVersion (optimistic lock)
  Approvals/    onay motoru (tutar eşiği / rol / sıralı-paralel adım)
  Idempotency/  Idempotency-Key middleware + tablo
  Sync/         Syncable migration makrosu ve trigger'lar (A6)
  Http/         ApiResponse, ListQuery, ErrorCode enum, exception render (CRM bootstrap/app.php deseni)
  Support/      CRM'den port: CsvFormulaGuard, HtmlSanitizer, TurkishCase, PhoneNormalizer, FractionalIndex
app/Modules/<Modül>/
  Http/{Controllers,Requests,Resources}  Models  Services  Repositories  Policies  Contracts
  Events  Listeners  Jobs  Enums  Data  Assistant/Tools  Database/{migrations,factories,seeders}
  routes.php  <Modül>ServiceProvider.php
```

**Modüller:** Identity, Organization, MasterData, Accounting, Inventory, Sales, Purchasing, Treasury, EDocuments, Manufacturing, HumanResources, FixedAssets, Projects, Budgeting, Reporting, Workflow, Assistant, Files, Notifications, Settings. Sync modülü masaüstü fazında eklenir.

**Kurallar:**
- Modüller arası erişim yalnızca `Contracts` ve domain event'leriyle olur. Bu kural Pest `arch()` testleriyle CI'da zorlanır.
- Repository sorgu katmanıdır. Yazmalar Service içinde `DB::transaction` ile yapılır.
- Kod tabanı genelinde: `declare(strict_types=1)`, statüler PHP backed enum, katmanlar arası veri `final readonly` DTO (`FormRequest::toDto()`).
- Rotalar `/api/v1` altında: `Route::apiResource` + `whereUuid`, aksiyonlar alt rota (`POST /sales-invoices/{id}/post`).
- Yanıt sözleşmesi CRM ile birebir: `{data, meta:{pagination}}` / `{errors:{message, code, fields}}`.
- Hata kodları tek bir `ErrorCode` enum'unda toplanır, OpenAPI üzerinden FE'ye geçer. Mesajlar `lang/{tr,en,de,fr}`'den gelir; serviste metin hardcode edilmez.
- Kod ve kimlikler İngilizce. Yorumlar kısa, İngilizce ve yalnızca "neden"i anlatır. Dokümanlar Türkçe; README EN+TR.

### Frontend
```
frontend/src/
  app/         router (route bazlı lazy + errorElement), providers, ErrorBoundary
  components/  ui/ (shadcn/Radix)  layout/ (AppShell, Sidebar, CompanySwitcher)  shared/
  features/<modül>/{api,components,hooks,pages,schemas,types}
  lib/         api/ (üretilmiş openapi tipleri + client), echo, queryClient, money, datetime, i18n
  platform/    Platform arayüzü + web adaptörü (A6)
  stores/      auth, company, theme, ui (Zustand)
```

- **`components/shared` tek kaynaktır:** `DataTable` (sanal kaydırma, kolon seçici, kayıtlı görünüm, toplu işlem), `DocumentLinesEditor` (klavyeyle satır girişi), `MoneyInput`, `QuantityInput`, `PartyCombobox`, `ItemCombobox`, `AccountCombobox`, `StatusBadge`, `ApprovalTimeline`, `AttachmentPanel`, `AuditTrail`, `useDebouncedValue`. Bu, CRM'deki 11 kopya `useDebouncedValue` ve 4 kopya combobox sorununu baştan engeller.
- **CRM'den korunan desenler:** query-key factory, mutation + invalidate + toast, realtime hook'larının doğrudan Query cache'ine yazması, 419/401/403 interceptor'ları, `usePermission`, `RequireAuth`, izin farkındalıklı Ctrl/Cmd+K paleti, kayıtlı görünümler, açık/koyu/sistem teması.

## A3. ERP çekirdek değişmezleri (bağlayıcı)

1. **Para ve miktar:** float yasak.
   - DB: tutar `numeric(20,4)`; fiyat, kur ve miktar `numeric(20,6)`.
   - Tip zinciri: PHP `brick/money` → JSON'da string → UI'da `decimal.js`.
   - Otorite sunucudur; UI'daki hesap yalnızca önizleme.
   - Yuvarlama politikası (satır bazlı KDV, kuruş farkı) `TAX-ENGINE.md`'de yazılı ve test edilir.
2. **Çift taraflı defter:** her finansal belge tek bir `PostingService` üzerinden hesap belirleme kurallarıyla yevmiye üretir.
   - Borç = alacak eşitliği bir Postgres `DEFERRABLE INITIALLY DEFERRED` constraint trigger'ı ile zorlanır.
   - Kesinleşmiş satıra UPDATE/DELETE trigger ile engellenir; düzeltme ters kayıtla yapılır.
   - Kapalı döneme kayıt atılamaz.
3. **Stok defteri:**
   - `stock_movements` append-only'dir ve tek doğruluk kaynağıdır. `stock_balances` aynı transaction içinde güncellenir.
   - Değerleme hareketli ağırlıklı ortalama veya FIFO olur, şirket bazlı seçilir.
   - Rezervasyon ve negatif stok politikası depo bazlıdır.
4. **Belge yaşam döngüsü:** `draft → submitted → approved → posted → cancelled/reversed`. Geçişler merkezi `StateMachine` ile yapılır; her geçiş = transaction + domain event + audit. Broadcast commit sonrası.
5. **Boşluksuz numaralandırma:** (şirket, belge tipi, seri, mali yıl) bazında. Numara **kesinleştirmede** verilir. e-Fatura formatı (`ABC2026000000001`) desteklenir. Yevmiye madde numarası da boşluksuzdur.
6. **Eşzamanlılık:** her düzenlenebilir belgede `version` kolonu; çakışmada 409 `VERSION_CONFLICT`. Stok ve numaralandırmada `SELECT … FOR UPDATE`.
7. **Idempotency:** tüm POST komutları `Idempotency-Key` başlığını kabul eder.
8. **Kimlikler:** UUIDv7 PK. Sırayla tahmin edilemez ve istemci tarafından üretilebilir (masaüstü taslakları için).
9. **Çok şirket izolasyonu:**
   - `company_id` + `BelongsToCompany` global scope + Policy.
   - Aktif şirket `X-Company-Id` başlığıyla gelir ve üyelik kontrolünden geçer. spatie `team_id` = şirket.
   - Bir arch testi her şirket bazlı modelde scope'u doğrular.
   - Faz 14'te Postgres RLS ikinci savunma hattı olarak eklenir.
10. **Silme:** ana veride soft delete; işlem belgeleri silinmez, iptal edilir. Toplu silme komutları ENGINEERING-RULES §6'ya tabidir.
11. **Zaman:** timestamp'ler UTC. İş tarihleri `date` tipindedir ve şirket saat dilimiyle yorumlanır (Europe/Istanbul).

## A4. Modül kapsamı (Türkiye öncelikli)

| Modül | İçerik |
|---|---|
| **Platform** | Giriş, 2FA, oturum ve cihaz yönetimi, zorunlu şifre değişimi, pasif kullanıcının WebSocket'ten anında düşürülmesi. Kullanıcı/rol/izin matrisi, şirket/şube/departman. Ayarlar, bildirim, ekler (MinIO/S3), audit, oturum ve sayfa logları, Ctrl+K, kayıtlı görünümler, onay akışları, otomasyon kuralları (sabit katalog), içe/dışa aktarma. |
| **Ana veriler** | Cari kartlar (müşteri/tedarikçi rolü, VKN/TCKN doğrulama, risk limiti), stok ve hizmet kartları, varyant, birim ve çevrim, barkod, fiyat listeleri ve iskonto kuralları. Vergi kodları (KDV, tevkifat kod ve oranları, istisna kodları, ÖTV). Döviz ve TCMB kurları (CRM'deki XXE-güvenli çekici port edilir), ödeme vadeleri, masraf merkezi ve proje boyutları. |
| **Genel muhasebe** | TDHP seed'i (düzenlenebilir, 7/A–7/B), mali yıl ve dönemler, fiş türleri (açılış, mahsup, tahsil, tediye, kapanış), hesap belirleme, mizan, büyük defter, yevmiye, dönem kapanışı ve kilidi, kur değerleme. |
| **Stok & depo** | Çoklu depo ve lokasyon, giriş/çıkış/transfer, sayım fark fişi, lot/seri ve SKT, rezervasyon, yeniden sipariş noktası, değerleme ve maliyet raporları. |
| **Satış** | Teklif → sipariş → sevk irsaliyesi → fatura → iade. Fiyat ve iskonto motoru, risk limiti, kısmi sevk ve faturalama. |
| **Satınalma** | Talep → RFQ → sipariş → mal kabul → alış faturası, 3'lü eşleştirme, tedarikçi değerlendirme. |
| **Finans & cari** | Cari ekstre, tahsilat/tediye, kasa, banka, kredi kartı/POS. **Çek/senet portföyü:** ciro, tahsile verme, teminat, karşılıksız. Banka ekstresi içe aktarma (CSV, MT940) ve mutabakat, kapama, yaşlandırma, ödeme planı, kur farkı faturası. |
| **e-Dönüşüm** | UBL-TR 2.1 üretimi + XSD ve şematron doğrulama. e-Fatura (TEMEL/TİCARİ/İHRACAT/KAMU), e-Arşiv, e-İrsaliye, gelen kutusu, mükellef sorgulama. `EDocumentProvider` arayüzü + **Sandbox (mock) sürücü**. Gerçek entegratör kimlik bilgisi girilerek açılır (LLM'deki felsefeyle aynı). |
| **Üretim** | Çok seviyeli ürün ağacı, rota ve operasyonlar, iş merkezleri, iş emri (malzeme çıkışı, üretimden giriş, fire), maliyet toplama, MRP (net ihtiyaç → planlı satınalma/üretim), temel kapasite görünümü. |
| **İK & Bordro** | Özlük, organizasyon şeması, izin hakedişi, puantaj. **Parametrik bordro:** brüt ↔ net, SGK işçi/işveren, işsizlik, kümülatif gelir vergisi dilimleri, damga vergisi, asgari ücret istisnası, BES. Yıllık parametreler kod değil veridir. Muhasebeleştirme, PDF bordro pusulası, masraf beyanı. |
| **Sabit kıymet** | Demirbaş kaydı, VUK amortisman (normal/azalan bakiyeler, kıst), elden çıkarma. |
| **Proje & bütçe** | Proje, görev, zaman çizelgesi, proje maliyeti ve faturalama. Hesap ve masraf merkezi bütçeleri, bütçe-gerçekleşen karşılaştırması. |
| **Raporlama & BI** | Canlı rol bazlı dashboard'lar (Reverb), bilanço, gelir tablosu, nakit akışı, KDV listeleri, Ba/Bs, stok ve satış analizleri, temel konsolidasyon (şirketler arası eliminasyon), zamanlanmış e-posta raporları. |
| **Asistan** | Bkz. A5. |

**Sonraya bırakılanlar:** e-Defter (XBRL-GL + mali mühür), POS/perakende, e-ticaret entegrasyonları, kalite ve bakım, Syncra CRM bağlayıcısı, mobil.

> Vergi ve bordro oranları ile UBL-TR şemaları, her faz başında resmî kaynaklardan (GİB, SGK, Resmî Gazete) güncel haliyle doğrulanır. Seed'ler bu kaynaklara referans verir.

## A5. Asistan katmanı (LLM-hazır, varsayılan kapalı)

- **Paket:** `laravel/ai` (resmî). Hazır sağlayıcılar: OpenAI, Anthropic, Gemini, Azure, Bedrock, Mistral, Groq, DeepSeek, xAI, OpenRouter, Ollama, OpenAI-uyumlu uçlar.
- **Açma:**
  - Sağlayıcı anahtarları `config/ai.php` → `.env` üzerinden okunur (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`…).
  - Bizim `config/assistant.php` dosyamız: `ASSISTANT_ENABLED=false`, `ASSISTANT_PROVIDER=`, `ASSISTANT_MODEL=`, adım sınırı, kullanıcı başına günlük token bütçesi, PII maskeleme, saklama süresi.
  - README'de "Asistanı etkinleştirme" bölümü olur (3 satır `.env`).
- **Kapalıyken:**
  - `GET /api/v1/assistant/status` → `{enabled:false}`. UI başlatıcıyı gizler, admin'e kurulum kartı gösterir.
  - Diğer uçlar 503 `ASSISTANT_DISABLED` döner. **Hiçbir dış çağrı yapılmaz.** Bu, CRM `PHASE-AUDIT.md` §5.2'deki kapalı devre ilkesiyle uyumludur.
  - Verisini dışarı çıkarmak istemeyen için Ollama veya yerel OpenAI-uyumlu uç belgelenir.
- **Ajan:** `Modules/Assistant/Agents/ErpAssistant` (laravel/ai `Agent` + `HasTools` + `Conversational`). Konuşmalar `assistant_conversations`, `assistant_messages`, `assistant_tool_calls` tablolarında tutulur, şirket ve kullanıcı bazında kapsanır.
- **Araç kaydı:** her modül `Assistant/Tools/*Tool` sağlar. Ortak `ErpTool` tabanı `permission()` ve `kind(): read|draft` tanımlar.
  - LLM'e yalnızca kullanıcının yetkili olduğu araçlar gönderilir; `handle()` içinde Policy tekrar kontrol edilir.
  - Araçlar yalnızca modül Service/Contract'larını çağırır. Ham SQL, URL veya kod çalıştırma aracı yoktur. Çıktı boyutu sınırlıdır.
- **Yazma = taslak + insan onayı:**
  - Taslak araçları `requireApproval()` (laravel/ai `Approvable`) kullanır. UI'da önizleme/diff kartı gösterilir; onaylanınca taslak belge oluşur ve linki verilir.
  - Asistan **kesinleştiremez, onaylayamaz, ödeme yapamaz, silemez**.
  - Örnekler: kritik stoklar için satınalma talebi taslağı, yevmiye taslağı, teklif taslağı. Okuma tarafında: stok durumu, yaşlandırma, bakiye, satış özeti, geciken siparişler, kayıt arama.
- **Akış:** SSE uç noktası `POST /api/v1/assistant/conversations/{id}/messages` (`text/event-stream`). Masaüstü aynı ucu kullanır.
- **Güvenlik:** belge içeriği veri olarak işaretlenir (prompt injection'a karşı), kullanıcı başına rate limit ve token bütçesi, her araç çağrısı audit'lenir, admin kullanım ekranı.
- **Frontend:** `features/assistant` sağ panel (Ctrl+J), kayıt bağlam çipleri, onay kartları, güvenli markdown render.
- **Test:** laravel/ai `Fake*Gateway` ile gerçek LLM olmadan: araç seçimi, izin filtresi, onay akışı, kapalı mod, bütçe aşımı.
- **Opsiyonel (sonra):** pgvector + embedding ile yardım dokümanı ve not üzerinde semantik arama.

## A6. Masaüstüne hazırlık (web fazlarında yapılır, sonradan retrofit gerekmez)

CRM'de masaüstü için backend'de 55, frontend'de 89 dosya sonradan değişti. Keystone'da bu zemin baştan web reposuna konur:

- **Kimlik ve eşzamanlılık:** UUIDv7 PK (istemci üretebilir), `version` kolonu, `Idempotency-Key`. Bunlar zaten A3'te var.
- **Syncable makrosu:** `$table->syncable()` migration makrosu senkronlanabilir tablolara `sync_txid xid8` kolonu, index ve `BEFORE INSERT/UPDATE` trigger'ı (`pg_current_xact_id()`) ekler. Silmeler için `sync_tombstones` trigger'ı. Kapsam: ana veriler ve taslaklanabilir belgeler.
- **Token auth:** Sanctum token guard'ı (`abilities`, süre sonu) web fazında test edilir. Device-login ucu masaüstü fazında eklenir.
- **Frontend platform arayüzü:** `frontend/src/platform/` altında `http`, `realtime`, `connectivity`, `notify`, `files` (kaydet/yazdır/aç) tanımlanır, şimdilik yalnızca web adaptörüyle.
  - Feature'lar ağa **yalnızca `platform.http` üzerinden** çıkar. Bunu bir ESLint kuralı zorlar: feature içinde axios veya fetch import'u yasak.
- **Standart query key'ler:** `[resource, …]` formatında. Böylece masaüstü invalidation'ı jenerik olur, CRM'deki elle yazılmış eşleme tablosu gerekmez.

## A7. Web fazları

**Çalışma modeli** CRM `docs/ENGINEERING-RULES.md` ile aynı: teknik lider + şeritler, dosya sahipliği, önce sözleşme, yıkıcı komut güvenliği.

**Her faz şu şekilde biter:** testler yeşil + CI yeşil (`gh run watch --exit-status`) + `docs/PROGRESS.md` güncel + commit.

| Faz | Teslimat |
|---|---|
| **0 — İskelet** | git init, monorepo, docker-compose, Laravel 13 + React 19 iskeleti, Pint/Larastan/Pest/ESLint/Prettier/Vitest/Playwright, GitHub Actions, Scramble → openapi-typescript hattı, `docs/` (ROADMAP, ENGINEERING-RULES, ARCHITECTURE, ilk ADR'ler), `dev.bat`. |
| **1 — Platform çekirdeği** | `Core/*` (A6 dahil), Identity (auth, 2FA, oturumlar), Organization, RBAC (teams), audit ve loglar, Files, Notifications, Settings, Workflow/Approvals. FE: AppShell, şirket değiştirici, tema, i18n, Ctrl+K, `platform/`, `DataTable`, form altyapısı. |
| **2 — Ana veriler** | Cari, stok/hizmet kartları, birimler, vergi kodları, kurlar, vadeler, fiyat listeleri, depolar, boyutlar, içe/dışa aktarma. |
| **3 — Genel muhasebe** | TDHP, dönemler, fişler, `PostingService` + trigger'lar, hesap belirleme, mizan, defterler, kapanış, kur değerleme. |
| **4 — Stok & depo** | Hareketler, değerleme, transfer, sayım, lot/seri, rezervasyon. |
| **5 — Satış** | Teklif → iade zinciri, risk kontrolü, GL ve stok kayıtları. |
| **6 — Satınalma** | Talep → fatura zinciri, 3'lü eşleştirme, onaylar. |
| **7 — Finans & cari** | Kasa, banka, çek/senet, tahsilat/tediye, mutabakat, yaşlandırma, kur farkı. |
| **8 — Asistan** | A5 çerçevesi + buraya kadarki modüllerin araçları. Sonraki fazlar kendi araçlarını ekler. |
| **9 — e-Dönüşüm** | UBL-TR, doğrulama, sandbox sürücü, e-Fatura/e-Arşiv/e-İrsaliye, gelen kutusu. |
| **10 — Üretim** | Ürün ağacı, rotalar, iş emirleri, MRP. |
| **11 — İK & Bordro** | Özlük, izin, puantaj, bordro motoru, masraf. |
| **12 — Sabit kıymet, proje, bütçe** | A4. |
| **13 — Raporlama & BI** | Finansal tablolar, dashboard'lar, KDV ve Ba/Bs, konsolidasyon, zamanlanmış raporlar. |
| **14 — Güvenlik & performans** | Red-team turu (CRM Faz 13 gibi), Postgres RLS, CSP ve başlıklar, rate limit gözden geçirmesi, k6 yük testi, sorgu ve index denetimi, yedekleme/geri yükleme provası, Pulse, Horizon, yapısal log, opsiyonel Sentry DSN. |
| **15 — Teslim** | Prod Docker imajları (php-fpm + nginx, horizon, reverb, scheduler), dağıtım rehberi, demo seed, ekran görüntülü README EN/TR. |

## A8. Web doğrulama

- **Backend:** `composer test` (Pest, paralel, Postgres test DB). Kapsam:
  - arch testleri: modül sınırları, strict_types, şirket scope'u
  - Policy/IDOR güvenlik testleri
  - **Değişmez testleri:** mizan her zaman sıfırlanır, stok bakiyesi = hareket toplamı, numaralarda boşluk yok
  - resmî örneklerden altın değer testleri: KDV, tevkifat, bordro, amortisman
  - UBL-TR XSD doğrulaması
- **Statik analiz:** `pint --test`, `phpstan analyse`.
- **Frontend:** `npm run lint`, `tsc -b`, `npm run test` (Vitest + MSW), `npm run build`, i18n eşitlik kontrolü.
- **E2E (Playwright, docker-compose üstünde):**
  - order-to-cash: teklif → fatura → tahsilat → mizan
  - procure-to-pay
  - üretim: iş emri → stok
  - bordro: hesapla → muhasebeleştir
  - dönem kapanışı
  - asistan: kapalı mod ve sahte sağlayıcıyla
- **Sözleşme:** CI'da OpenAPI ve FE tipleri yeniden üretilir, `git diff --exit-code` ile kontrol edilir. Kırıcı değişiklik `oasdiff` ile yakalanır.
- **Manuel:** `dev.bat` ile tüm servisler açılır. İki şirketle veri izolasyonu, canlı dashboard güncellemesi ve iki sekmede eşzamanlı düzenlemede 409 davranışı kontrol edilir.

---

# Masaüstü özeti

Ayrıntılı plan: `C:\dev\-ERP-Desktop\plan.md`.

Web tamamlandıktan sonra `-ERP-Desktop` reposu bu reponun **git geçmişiyle birlikte forku** olarak açılır. Web değişiklikleri `upstream` remote'undan merge edilir.

- **Upstream-first:** masaüstü reposu `backend/`, `frontend/` ve `contracts/` klasörlerini değiştirmez; CI'daki drift guard bunu doğrular.
- **Sync sunucu modülü bu repoda yaşar** (`Modules/Sync`). Değişiklik akışı xid watermark ile çalışır, global kilit yoktur.
- **Masaüstü kabuğu:** Tauri 2.12 + Rust (`keystone-sync` crate, SQLCipher yerel depo, outbox, Conflict Inbox).
- **Çevrimdışı kapsam:** okuma + taslak. Kesinleştirme, onay, ödeme, numara verme ve stok düşümü yalnızca çevrimiçi.
- **Taşıma katmanı:** webview ağa hiç çıkmaz; tüm HTTP Rust üzerinden geçer, token webview'e gelmez.
- **Bu repoda baştan hazırlanacak zemin:** A6'daki maddeler. Böylece masaüstü fazında retrofit gerekmez.

---

# BÖLÜM C — Dış etkili adımlar (her biri o anda ayrıca onaylanır)

- GitHub repolarının oluşturulması ve push. Önerilen adlar `Keystone-ERP` ve `Keystone-ERP-Desktop`; görünürlük (public/private) o adımda sorulur.
- PHP 8.4 kurulumu (Herd veya winget), Docker container'larının başlatılması.
- Seed, reset ve toplu silme gibi yıkıcı DB komutları (ENGINEERING-RULES §6).
- Masaüstü release'i için kod imzalama sertifikası (Windows Authenticode / Azure Trusted Signing) ve updater anahtarı. D6'da kararlaştırılır.
