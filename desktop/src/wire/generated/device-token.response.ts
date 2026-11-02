// Do not edit: written by scripts/gen-wire-ts.mjs from contracts/.
// After a contract change run `npm run -w desktop wire:gen` and commit.

/**
 * Cihaz token yanıtı. POST /api/v1/auth/device (ilk giriş) ve POST /api/v1/auth/device/refresh (yenileme) başarılı yanıtı; ikisi aynı şekli döner. Bugünkü {token, expires_at} yanıtı refresh_token ve refresh_expires_at ile genişletilir. Identity uç sözleşmesidir; D1'de OpenAPI'ye taşınır. Bkz. ADR 0007.
 */
export interface DeviceTokenResponse {
  data: {
    /**
     * desktop yetenekli Sanctum erişim token'ı (Bearer). Ömrü 60 dakika.
     */
    token: string
    /**
     * ISO 8601 zaman damgası, saat dilimi ofsetiyle (API Resource'ların toIso8601String çıktısı).
     */
    expires_at: string
    /**
     * Opak, tek kullanımlık refresh token. Sunucu yalnızca özetini saklar (device_refresh_tokens.token_hash). Her yenilemede aynı ailede yenisi verilir ve kullanılan işaretlenir (used_at).
     */
    refresh_token: string
    /**
     * ISO 8601 zaman damgası, saat dilimi ofsetiyle (API Resource'ların toIso8601String çıktısı).
     */
    refresh_expires_at: string
  }
  meta?: Meta
}
/**
 * Başarılı yanıtın meta nesnesi. Senkron uçları ek alan koymaz; ileride eklenebilir.
 */
export interface Meta {
  [k: string]: unknown
}
