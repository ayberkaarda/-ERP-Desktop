// Do not edit: written by scripts/gen-wire-ts.mjs from contracts/.
// After a contract change run `npm run -w desktop wire:gen` and commit.

/**
 * POST /api/v1/auth/device isteği. Cihaz girişi. Alanlar mevcut DeviceLoginRequest kurallarıyla aynıdır. Başarılı yanıt device-token.response.schema.json. Identity uç sözleşmesidir; D1'de OpenAPI'ye (Scramble) taşınır, o zamana kadar tek kaynak bu dosyadır. Bkz. ADR 0007.
 */
export interface DeviceLoginRequest {
  email: string
  password: string
  /**
   * 2FA açıksa zorunlu: 6 haneli TOTP veya kurtarma kodu. Eksikse TWO_FACTOR_REQUIRED (401), yanlışsa INVALID_TWO_FACTOR_CODE (422).
   */
  two_factor_code?: string | null
  device_name: string
  /**
   * Cihaza özgü, kurulum boyunca değişmeyen değer. Aynı kullanıcı ve fingerprint ile yeni giriş önceki cihaz kaydını ve refresh ailesini iptal eder.
   */
  fingerprint: string
}
