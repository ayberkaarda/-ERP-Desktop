# Asistan

Asistan, Laravel AI SDK üzerinden isteğe bağlı çalışan bir uygulama katmanıdır. Varsayılan olarak kapalıdır. Kapalı durumdaki `GET /api/v1/assistant/status` yanıtı bunu bildirir; diğer asistan uçları `503 ASSISTANT_DISABLED` döndürür. Asistan kapalıyken bir model sağlayıcısına çağrı yapılmaz.

## Etkinleştirme

Dağıtım ortamında sağlayıcının kendi API anahtarını ve aşağıdaki ayarları tanımlayın:

```dotenv
ASSISTANT_ENABLED=true
ASSISTANT_PROVIDER=openai
ASSISTANT_MODEL=your-provider-model
```

Sağlayıcı anahtarları `config/ai.php` içindeki ortam değişkenlerinden okunur; örneğin OpenAI için `OPENAI_API_KEY`, Anthropic için `ANTHROPIC_API_KEY` kullanılır. Anahtarları kaynak koduna, konuşmalara veya tarayıcı yapılandırmasına eklemeyin. Sağlayıcı/model tanımı eksikse asistan uçları `ASSISTANT_NOT_CONFIGURED` hatası verir. Durum yanıtı anahtarları veya sağlayıcı bağlantı adresini açıklamaz. Desteklenen sağlayıcı ve model özellikleri kurulu SDK sürümüne bağlıdır; üretimden önce seçilen sağlayıcıyla araç çağrısı desteğini doğrulayın.

Yerel Ollama için `ASSISTANT_PROVIDER=ollama`, araç çağrısı destekleyen yerel model adı ve `OLLAMA_URL=http://localhost:11434` kullanılabilir. OpenAI uyumlu bir sunucu için `ASSISTANT_PROVIDER=openai-compatible`, `OPENAI_COMPATIBLE_URL` ve sunucunun gerektirdiği `OPENAI_COMPATIBLE_API_KEY` tanımlanır. Bunlar sunucu ortamı ayarlarıdır; kullanıcı mesajları bu adresleri belirleyemez.

## Yetki ve şirket kapsamı

`assistant.use` konuşma ve araç erişimini, `assistant.usage.view` kullanım raporunu yönetir. Araçların ayrıca kendi alan izinleri bulunur. Konuşmalar aktif şirket ve kullanıcıya aittir; başka kullanıcıya veya şirkete ait konuşma ve onay kimliği erişim sağlamaz. Model yalnızca kullanıcının yetkili olduğu araçları görür. Araç yürütülürken izinler tekrar kontrol edilir.

Mevcut bir kuruluma eklenirken migration'lardan sonra izin kataloğunu ve şirket yöneticisi rollerini güncelleyin:

```sh
php artisan db:seed --class='App\Modules\Identity\Database\seeders\IdentitySeeder'
```

Bu işlem mevcut Admin rollerine yeni katalog izinlerini ekler. Var olan diğer rollerin özelleştirilmiş izinleri korunur; bu rollere `assistant.use` yetkisini yönetim ekranından gerektiğinde ayrıca verin. Yeni şirketlerin varsayılan rollerinde asistan kullanım izni tanımlıdır; alan izinleri araç erişimini yine sınırlar.

Okuma araçları yayımlanmış modül sözleşmeleri üzerinden sınırlı sonuçlar döndürür. Araçlar rastgele SQL, kod veya bağlantı adresi çalıştırmaz. Kayıtlardaki açıklama ve metinler talimat olarak kabul edilmez.

| Alan | Araçlar |
|---|---|
| Ana veriler | Stok kartı ve cari arama; depo, masraf merkezi, proje, vade ve şirket para birimi listeleri |
| Muhasebe | Hesap arama, tarih itibarıyla hesap bakiyesi, genel yevmiye taslağı |
| Stok | Depo bazında rezervasyonlar düşüldükten sonra kullanılabilir miktar |
| Satış | Satış özeti, geciken açık siparişler, müşteri yaşlandırması, teklif taslağı |
| Satın alma | Açık siparişler ve talepler, tedarikçi yaşlandırması, talep taslağı |
| Finans | Tarih itibarıyla kasa, banka ve POS bakiyeleri; para birimleri ayrı tutulur |
| e-Belgeler | Yetkili gelen/giden belgelerin sınırlı durum sorgusu; XML, vergi kimliği ve gönderim işlemi içermez |

## Taslak onayı

Yazma araçları önce bekleyen bir onay oluşturur. Kullanıcı, araç adını ve kaydedilmiş parametrelerini inceleyip onaylar veya reddeder. Onay uç noktası yalnızca sunucuda saklanan parametreleri kullanır; istemciden değiştirilmiş araç parametresi almaz. Onay sırasında şirket, kullanıcı ve alan izinleri yeniden doğrulanır. Yinelenen aynı karar ikinci bir belge oluşturmaz; çelişen karar reddedilir.

Oluşturulan belge kendi modülünün taslak durumunda kalır. Asistan belge kesinleştirme, iş onayı verme, ödeme gerçekleştirme veya silme aracı sağlamaz. Belgenin sonraki adımları ilgili modülün normal akışından yürütülür.

Modelin araç çağrısı, parametre önizlemesi ve sonucu kaydedilir. Onay yürütmesi alan doğrulamasından geçmezse belge yazımı geri alınır ve özgün araç çağrısı bekleyen durumda kalır; kullanıcı taslağı reddedip düzeltilmiş bir öneri isteyebilir. HTTP işlemi geri alındığında başarısız onay denemesi için ayrı bir kalıcı audit satırı garanti edilmez.

## Konuşma akışı

Uçlar `/api/v1/assistant` altındadır. Normal kimlik doğrulama, CSRF ve `X-Company-Id` kuralları geçerlidir.

| İşlem | Uç |
|---|---|
| Durum | `GET /status` |
| Konuşma listesi / oluşturma | `GET /conversations`, `POST /conversations` |
| Konuşma ayrıntısı | `GET /conversations/{id}` |
| Mesaj | `POST /conversations/{id}/messages` |
| Onay veya ret | `POST /conversations/{id}/approvals/{callId}` |
| Yönetim kullanım raporu | `GET /usage` |

Konuşma oluşturma ve karar uçları `Idempotency-Key` kullanır. Mesaj isteğindeki UUID `request_id` aynı mesajın tekrar işlenmesini önler. Bekleyen onay çözümlenmeden yeni mesaj gönderilmez.

Mesaj yanıtı `text/event-stream` biçimindedir. `start`, `delta`, `tool_approval`, `done` ve `error` olayları taşır. `done` içindeki konuşma, kaydedilmiş son durumdur. Hassas veri maskelemesi nedeniyle metin parçaları güvenli yanıt hazırlandıktan sonra iletilebilir. Hatalar konuşmada başarısız mesaj olarak kaydedilir; sağlayıcının ham hata ayrıntıları istemciye aktarılmaz.

Tarayıcı isteğini durdurmak, başlamış sunucu işlemini geri almaz. Yeniden açılan panel kaydedilmiş işlem durumunu izler. Süresi dolmuş işlemler sunucuda başarısız olarak kapatılır; ayrılmış bütçe yalnızca bir kez hesaplanır. Konuşma görünümü ve modele gönderilen geçmiş boyutla sınırlıdır; eski mesajlar görünümden çıkarıldığında arayüz bunu bildirir.

Arayüzde sağ panel `Ctrl+J` ile açılır. Asistan kapalıysa başlatıcı gizlenir; yetkili yöneticiler kurulum bilgisini görebilir. Şirket veya oturum değişimi açık istekleri ve önceki konuşma görünümünü temizler. Görüntülenen metin ham HTML çalıştırmaz.

## Veri ve kullanım

Konuşmalar, mesajlar ve araç çağrıları `assistant_*` tablolarında saklanır. İstek ve araç çıktısı sınırları, günlük kullanıcı token bütçesi, maskeleme ve saklama süresi `config/assistant.php` üzerinden yönetilir. Kullanım raporu aktif şirket kapsamındadır ve konuşma metinlerini içermez.

Günlük token bütçesi UTC günü ve kullanıcı bazındadır; şirket değiştirmek bütçeyi yenilemez. İstek başlamadan önce bir tur için bütçe ayrılır ve tamamlandığında bildirilen kullanımla hesap kapatılır. Sağlayıcı hatası nedeniyle kullanım bilgisi alınamazsa ayrılan tutar ihtiyatlı olarak tüketilmiş sayılır.

`ASSISTANT_TURN_TOKENS` bir tur için ayrılacak üst sınırdır; kalan günlük bütçe bunun altındaysa istek başlamaz. Bu değeri `ASSISTANT_DAILY_TOKENS` ile birlikte yapılandırın.

`php artisan assistant:prune` saklama süresini aşan konuşmaları temizler. Komut günlük zamanlayıcıya kayıtlıdır; dağıtımda Laravel zamanlayıcısı çalıştırılmalıdır. Etkin isteklerin konuşmaları temizleme sırasında korunur.

Konuşma saklama süresi kullanım toplamlarını silmez. Günlük kullanıcı/şirket kullanım kayıtları bütçe ve yönetim raporları için tutulur.

PII maskelemesi veri minimizasyonuna yardımcı olur; gönderilecek iş verilerini seçilen sağlayıcının veri işleme koşullarıyla birlikte değerlendirin. Yerel veya OpenAI uyumlu sağlayıcı kullanılacaksa adres ve kimlik bilgileri yalnızca sunucu tarafındaki sağlayıcı yapılandırmasına konur. Konuşma araçlarıyla sağlayıcı adresi değiştirilemez.

Geliştirme ve otomatik testler SDK'nın sahte yanıtlarını kullanır; gerçek sağlayıcı anahtarı gerektirmez.

## Başvuru

[Laravel AI SDK belgeleri](https://laravel.com/framework/docs/13.x/ai-sdk), sağlayıcı, araç ve insan onayı API'lerini açıklar. Uygulamanın çalıştığı API için kurulu `laravel/ai` sürümü esas alınır.
