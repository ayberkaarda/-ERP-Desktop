# ADR 0007: Masaüstü cihaz token'ları

- Durum: Kabul edildi
- Tarih: 2026-10-26

## Bağlam

Masaüstü istemci tarayıcı oturum çerezi kullanamaz ve uzun süre çevrimdışı kalabilir. Kimlik bilgisi cihazda saklanır; kaybolan veya devredilen bir cihaz tek başına iptal edilebilmelidir. Uzun ömürlü tek bir erişim token'ı çalındığında uzun süre geçerli kalır.

## Karar

- `POST /api/v1/auth/device`, kimlik bilgisi ve 2FA etkinse TOTP ile `desktop` yetenekli bir Sanctum erişim token'ı ve aynı yanıtta ailenin ilk refresh token'ını verir: `{data: {token, expires_at, refresh_token, refresh_expires_at}}`. Token `user_devices` kaydına ve cihaz parmak izine bağlıdır; aynı parmak iziyle yeni giriş önceki kaydı ve ailesini iptal eder.
- Erişim token'ı **60 dakika** geçerlidir. Refresh token **30 gün kayan** sürelidir ve tek kullanımlıktır.
- `POST /api/v1/auth/device/refresh` gövdesi `{refresh_token}`'dır; başarılı yanıt girişle aynı şekildedir. Her yenileme kullanılan token'ı `used_at` ile işaretler ve aynı ailede yenisini verir. Refresh token'lar yalnızca özetleriyle `device_refresh_tokens(id, device_id, token_hash, family_id, expires_at, used_at)` tablosunda tutulur.
- Kullanılmış bir refresh token'ın tekrar gelmesi ailenin tamamını, cihazın tüm token'larını ve cihaz kaydını iptal eder; yanıt 401 `UNAUTHENTICATED`'dır. Bilinmeyen, süresi dolmuş veya iptal edilmiş token da 401 `UNAUTHENTICATED` döner.
- Eşzamanlı yenileme desteklenmez; istemci yenilemeyi sıralar.
- `GET /api/v1/me/devices` ve `DELETE /api/v1/me/devices/{id}` cihazları listeler ve iptal eder. Kullanıcı pasifleştirme, parola değişimi ve yönetici sıfırlaması cihazın erişim ve refresh token'larını iptal eder.
- Senkron uçları yalnızca `desktop` yetenekli token'ı ve `X-Company-Id` başlığını kabul eder.
- İstek ve yanıt şemaları `contracts/sync/device-login.request.schema.json`, `device-refresh.request.schema.json` ve `device-token.response.schema.json` dosyalarındadır; D1'de uygulanınca OpenAPI'ye taşınır.

## Sonuçlar

Çalınan erişim token'ı en fazla bir saat işe yarar; çalınan refresh token'ın kullanımı, meşru istemcinin bir sonraki yenilemesinde yeniden kullanım olarak yakalanır ve cihaz iptal edilir. İptal edilen cihaz bir sonraki istekte `UNAUTHENTICATED` alır; yerel outbox kullanıcı yeniden giriş yapana kadar bekler. Bugünkü uygulama tek, 30 günlük token verir; refresh tablosu, ucu ve iptal bağlantıları D1'de eklenir. Ayrıntılar `docs/SYNC-PROTOCOL.md` "Token yaşam döngüsü" bölümündedir.
