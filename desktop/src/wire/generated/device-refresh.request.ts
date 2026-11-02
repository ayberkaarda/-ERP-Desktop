// Do not edit: written by scripts/gen-wire-ts.mjs from contracts/.
// After a contract change run `npm run -w desktop wire:gen` and commit.

/**
 * POST /api/v1/auth/device/refresh isteği. Erişim token'ını yeniler. Authorization başlığı gerekmez (erişim token'ı süresi dolmuş olabilir); yetki refresh_token'dır. Başarılı yanıt device-token.response.schema.json. Bilinmeyen, süresi dolmuş, iptal edilmiş cihaza ait veya daha önce kullanılmış (used_at dolu) refresh token 401 UNAUTHENTICATED döner; kullanılmış token durumunda sunucu önce cihazın aile kaydını ve tüm token'larını iptal eder. Eşzamanlı yenileme desteklenmez; istemci yenilemeyi sıralar. Hız sınırında 429 TOO_MANY_ATTEMPTS. Identity uç sözleşmesidir; D1'de OpenAPI'ye taşınır.
 */
export interface DeviceRefreshRequest {
  refresh_token: string
}
