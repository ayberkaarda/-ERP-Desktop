# Kimlik doğrulama akışları — Faz 1

Tüm API yolları `/api/v1` altındadır. Tarayıcı SPA kimlik doğrulaması Sanctum oturum çereziyle yapılır. Başarılı yanıtlar `{data: ...}`; hatalar `{errors:{message,code,fields?}}` biçimindedir.

## SPA oturumu ve parola girişi

1. İstemci `GET /sanctum/csrf-cookie` ile CSRF çerezini alır; oturum açma ve oturum gerektiren isteklerde çerezleri gönderir ve CSRF belirtecini Laravel'in beklediği başlıkta taşır. `419` yanıtında CSRF çerezini yenileyip isteği bir kez tekrarlar.
2. `POST /api/v1/auth/login` gövdesi `{email,password,remember?}` olur. E-posta ve IP çiftinde 15 dakika içinde 5 başarısız deneme `429 TOO_MANY_ATTEMPTS` ile kilitlenir.
3. Başarılı yanıtta kullanıcı ve `two_factor_required` döner. İki faktör kapalıysa oturum doğrulanmış olur; açıksa oturum doğrulanmamış kalır ve korumalı API erişimi açılmaz.
4. `GET /auth/me`, kullanıcıyı, şirketleri, şirket başına rol adlarını ve izinleri; ayrıca `is_super_admin`, `must_change_password` ve `two_factor_enabled` alanlarını verir.
5. `must_change_password` doğruysa normal korumalı işlemler `403 PASSWORD_CHANGE_REQUIRED` ile engellenir. Yalnızca parola değiştirme akışı tamamlandıktan sonra normal uygulama kullanımı sürer.

## Giriş ve iki faktör doğrulaması

```mermaid
sequenceDiagram
    participant SPA as Tarayıcı SPA
    participant API as Kimlik API'si
    participant DB as Kimlik deposu
    SPA->>API: GET /sanctum/csrf-cookie
    API-->>SPA: CSRF çerezi
    SPA->>API: POST /api/v1/auth/login {email,password,remember?}
    API->>DB: E-posta + IP deneme sayacı / kullanıcı doğrulama
    alt 5 başarısız deneme / 15 dakika
        API-->>SPA: 429 TOO_MANY_ATTEMPTS
    else Parola geçerli, 2FA kapalı
        API-->>SPA: {data:{user,two_factor_required:false}} + oturum çerezi
    else Parola geçerli, 2FA açık
        API-->>SPA: {data:{user,two_factor_required:true}} + doğrulanmamış oturum
        SPA->>API: POST /api/v1/auth/two-factor/verify {code | recovery_code}
        API->>DB: TOTP veya tek kullanımlık kurtarma kodunu doğrula
        alt Kod geçersiz
            API-->>SPA: 401 TWO_FACTOR_REQUIRED / 422 INVALID_TWO_FACTOR_CODE
        else Kod geçerli
            API-->>SPA: Oturumu doğrula
            API-->>SPA: Başarılı yanıt ve kimliği doğrulanmış oturum
        end
    end
    opt Parola değişimi zorunlu
        SPA->>API: POST /api/v1/auth/password/change {current_password,password,password_confirmation}
        API-->>SPA: Parola değiştirildi
    end
```

## TOTP kurulumu, doğrulama ve kurtarma

- Giriş tamamlandıktan sonra kullanıcı `POST /auth/two-factor/setup` çağırır; `secret`, `otpauth_url` ve `qr_svg` döner. Kullanıcı bunları doğrulama uygulamasına ekler.
- `POST /auth/two-factor/confirm {code}` geçerli TOTP'yi doğrular, 2FA'yı etkinleştirir ve `recovery_codes` listesini yalnızca bu yanıtta sunar. Kodlar güvenli biçimde saklanmalıdır.
- Sonraki girişte `POST /auth/two-factor/verify {code}` TOTP'yi, `{recovery_code}` ise tek kullanımlık kurtarma kodunu kabul eder. Geçersiz kod `422 INVALID_TWO_FACTOR_CODE` olur.
- Devre dışı bırakma `DELETE /auth/two-factor {password}` ile ve parola doğrulamasıyla yapılır.

## Parola, oturum ve cihaz güvenliği

- Zorunlu parola değişimi `POST /auth/password/change {current_password,password,password_confirmation}` ile yapılır.
- Oturumlar `GET /auth/sessions` ile listelenir; `DELETE /auth/sessions/{id}` seçilen oturumu sonlandırır. `POST /auth/logout` mevcut oturumu kapatır.
- Kullanıcı devre dışı bırakıldığında korumalı istekler `403 USER_DEACTIVATED` alır ve kullanıcıya ait etkin oturumlar/cihaz erişimleri iptal edilir. İstemci bu yanıtla yerel oturumu kapatır. Kimlik API'si `user.{id}` özel kanalında oturum/hesap kapatma olayını yayınlayarak açık istemcilere anlık çıkış bildirir.
- Yönetici parola sıfırlaması `POST /users/{id}/password-reset` ile yapılır; kullanıcı sonraki girişinde `must_change_password` üzerinden yeni parola belirlemeye zorlanır.
- Masaüstü istemcisi için `POST /auth/device {email,password,two_factor_code?,device_name,fingerprint}` Sanctum belirteci üretir; belirtecin yeteneği `desktop` olur ve `expires_at` döner. Cihaz akışı, bu yeteneği sunan istemci içindir.
- `GET /me/devices` kayıtlı cihazları listeler; `DELETE /me/devices/{id}` cihaz belirtecini iptal eder.

```mermaid
sequenceDiagram
    participant App as Masaüstü istemcisi
    participant API as Kimlik API'si
    participant DB as Kimlik deposu
    App->>API: POST /api/v1/auth/device {email,password,two_factor_code?,device_name,fingerprint}
    API->>DB: Kullanıcı, parola ve varsa 2FA kodunu doğrula
    alt Kimlik bilgisi veya 2FA kodu geçersiz
        API-->>App: Auth hatası
    else Geçerli
        API->>DB: Sanctum belirteci oluştur (ability: desktop)
        API-->>App: {data:{token,expires_at}}
        App->>API: API isteği, Bearer belirteci (desktop)
        API-->>App: İzin verilen yanıt
    end
    opt Hesap devre dışı bırakılır veya cihaz iptal edilir
        API->>DB: Oturum/belirteci iptal et
        API-->>App: Sonraki istek reddedilir; user.{id} üzerinden anlık çıkış olayı
    end
```