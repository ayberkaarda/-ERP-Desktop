# ADR 0007: Masaüstü cihaz token'ları

- Durum: Kabul edildi
- Tarih: 2026-10-26

## Bağlam

Masaüstü istemci tarayıcı oturum çerezi kullanamaz ve uzun süre çevrimdışı kalabilir. Kimlik bilgisi cihazda saklanır; kaybolan veya devredilen bir cihaz tek başına iptal edilebilmelidir.

## Karar

- `POST /api/v1/auth/device`, kimlik bilgisi ve 2FA etkinse TOTP ile `desktop` yetenekli bir Sanctum token'ı verir. Token `user_devices` kaydına ve cihaz parmak izine bağlıdır; aynı parmak iziyle yeni giriş öncekini iptal eder.
- Erişim token'ı kısa ömürlüdür. Yenileme, her kullanımda döndürülen ve cihaza bağlı bir refresh token ile yapılır. Kullanılmış bir refresh token'ın tekrar gelmesi cihazın tüm token'larını iptal eder.
- `GET /api/v1/me/devices` ve `DELETE /api/v1/me/devices/{id}` cihazları listeler ve iptal eder. Kullanıcı pasifleştirme, parola değişimi ve yönetici sıfırlaması cihaz token'larını iptal eder.
- Senkron uçları yalnızca `desktop` yetenekli token'ı ve `X-Company-Id` başlığını kabul eder.

## Sonuçlar

İptal edilen cihaz bir sonraki istekte `UNAUTHENTICATED` alır; yerel outbox kullanıcı yeniden giriş yapana kadar bekler. Bugünkü uygulama tek, 30 günlük token verir; refresh token ve yenileme ucu masaüstü fazında eklenir (`docs/SYNC-PROTOCOL.md`, Açık konular).
