# Keystone desktop threat model

Scope: the Tauri 2 desktop client (`desktop/`) and the parts of the Laravel server it depends on for sessions (`backend/app/Modules/Identity`). Every mitigation below names the file that implements it; a mitigation that is not in code is listed under [Residual risks](#residual-risks), not here. This is a portfolio project: it has no code signing, no auto-updater and no production release channel, and this document does not assume any.

Turkish twin: [THREAT-MODEL.tr.md](THREAT-MODEL.tr.md). Architecture background: [ARCHITECTURE.md](ARCHITECTURE.md) (Turkish).

## Assets

| Asset | Where it lives | Why it matters |
|---|---|---|
| Device session: access token (60 min) and rotating refresh token (30 days) | OS credential store, service `com.keystone.desktop`, account `<profile id>`, one JSON record `{tokens?, generation, deactivated}` (`crates/keystone-secrets/src/tokens.rs`, `keychain.rs`) | Bearer access to the user's ERP data on that server. TTLs: `backend/config/sanctum.php` (`device_access_ttl_minutes` 60), `DeviceTokens::payload` (30 days default). |
| SQLCipher key | OS credential store, account `db-key:<profile id>`, 32 random bytes as 64 hex (`crates/keystone-secrets/src/db_key.rs`) | Decrypts the local mirror and outbox. |
| Local mirror | `<app data>/profiles/<profile id>/keystone.db`, SQLCipher (`bootstrap.rs` `DB_FILE`, `crates/keystone-sync/src/store/mod.rs`) | Offline copy of business data (customers, orders, ...). |
| Outbox and conflicts | Same encrypted database | Unsent business writes; may contain data the server has not seen yet. |
| Device fingerprint slot | OS credential store, `slot:<name>` (`crates/keystone-secrets/src/slot.rs`) | Per-install secret sent as the device fingerprint with a device sign-in. |
| Profile registry | `<app data>/profiles.json` (`src-tauri/src/profiles.rs`) | Server URL, `meta` snapshot, selected company. Contains no secret; it is not encrypted. |
| Password in transit | Webview to Rust once, at `auth_login` (`src-tauri/src/commands/auth.rs`) | Not stored by the client. |

## Trust boundaries

1. Webview (React bundle, `desktop/src` plus `frontend/src`) is **untrusted-ish**: it renders server-supplied data. It has no network access (CSP `connect-src ipc: http://ipc.localhost`), no Tauri plugin permission beyond event listening, and reaches data only through the commands in `src-tauri/src/lib.rs` (`generate_handler!`).
2. Rust shell (`desktop/src-tauri`, crates `keystone-sync`, `keystone-secrets`, `keystone-realtime`) is **trusted**. It is the only code that holds tokens, the DB key and the HTTP client.
3. Server is **trusted for its own data, not for the client's safety**: the client treats a profile URL as attacker-chosen (see S1). Server-to-client authority is limited to API answers and three realtime user events.
4. The OS user account is the outer boundary. Anything running as the same user is outside this model (see residual risks).

## Attacker scenarios

### S1. Malicious or compromised server profile

The user adds a profile pointing at an attacker's server, or a real server is compromised.

Mitigations (verified):
- Only `https://host[:port]` with no path, query, fragment or credentials; plain `http` only for loopback and only when `KEYSTONE_DEV_ALLOW_HTTP` is set in a **debug** build (`crates/keystone-sync/src/client/url.rs` `ServerUrl::parse`; `src-tauri/src/bootstrap.rs` `allow_http`). The reqwest client is also `https_only` unless that flag is on (`client/http.rs` `build_http`).
- Redirects are disabled (`Policy::none()`, `build_http`), so a server cannot bounce the bearer token to another origin or to http.
- Endpoint paths must start with `/api/v1/` and consist of plain segments (`ServerUrl::endpoint`), so the webview or server data cannot steer a request to another path or host.
- Realtime: the Reverb host comes from the server's `meta`, but plain `ws` is refused unless a debug build, the dev flag and a loopback host all hold (`crates/keystone-realtime/src/config.rs` `plain_allowed`). Otherwise `wss` with the OS trust store. The token is never given to the realtime crate; channel auth is done by Rust (`broadcasting.rs`).
- Server responses reach the webview only as `api_request` results; response headers are allow-listed (`RESPONSE_HEADERS` in `client/http/proxy.rs`) and bodies are capped at 32 MB (`PROXY_BODY_LIMIT`).
- `profile_add` rejects servers whose `meta` demands a newer app or sync schema (`bootstrap.rs`, around `min_version`/`min_schema_version`).
- Data from one profile is not mixed into another: identity is `user:company`, and a different identity wipes the mirror before anything is pushed (`engine/pass.rs` `apply_session`).

Residual: a malicious server fully controls the data the user sees and can ask the user for credentials in its own login flow (`auth_login` sends the password to whatever server the profile names). There is no certificate pinning; trust is the OS root store (the TLS failure reason is surfaced, `client/http.rs`, but not pinned).

### S2. XSS or compromised code in the webview

Mitigations (verified):
- CSP in `src-tauri/tauri.conf.json`: `default-src 'self'; connect-src ipc: http://ipc.localhost; script-src 'self'; style-src 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; base-uri 'self'`. No `unsafe-inline`, no `unsafe-eval`. Injected script cannot call out with `fetch`/XHR/WebSocket.
- The CSP is enforced at build time: `src-tauri/build.rs` + `src/build_guard.rs` fail a release build on a missing or placeholder CSP, a network `connect-src`, remote sources in other directives, nonces, unsafe keywords, `report-uri`, a second window, `dangerousDisableAssetCspModification`, or `KEYSTONE_DEV_ALLOW_HTTP`.
- Navigation lock: the main window is created in code with `on_navigation` (app origin only) and `on_new_window` (always deny) (`src-tauri/src/lib.rs`, `app_url_allowed`, `create_main_window`), because CSP does not cover top-level navigation.
- Capability is minimal: `src-tauri/capabilities/default.json` grants only `core:event:allow-listen` and `allow-unlisten` to the `main` window. No fs, http, dialog, shell, window or path permissions; `withGlobalTauri` is false.
- The webview never sees a token. The Bearer header is added in Rust; the webview cannot set `Authorization` because only four request headers are forwarded (`REQUEST_HEADERS`: `idempotency-key`, `accept-language`, `if-none-match`, `content-type`).
- The webview cannot reach `/api/v1/auth/*` (except `GET auth/me`), `/api/v1/sync/*` or `broadcasting/auth` through `api_request` (`FORBIDDEN`, `AUTH_READS` in `client/http/proxy.rs`).
- Opening a URL is not a webview capability: `open_external` takes one of three fixed targets and builds the URL in Rust from the active profile (`src-tauri/src/commands/external.rs`).
- Logging masks tokens, passwords, channel signatures, e-mail and phone (`src-tauri/src/logging.rs`).

Residual: XSS can still call every registered command as the signed-in user, for example `api_request` on any allowed `/api/v1/` path, `auth_devices_revoke`, `auth_sign_out`, `profile_remove`. It cannot exfiltrate over the network or read the token, but it can act with the user's authority and could try to leak data through allowed channels (for example by writing it to the server through the API). Commands are not capability-gated (`ARCHITECTURE.md`: "Uygulama komutları capability ile kapılı değildir"); each validates its own input. Webview-side token absence was measured only before sign-in (ARCHITECTURE "Takip listesi").

### S3. Stolen device or disk

Mitigations (verified):
- The database is SQLCipher (`rusqlite` feature `bundled-sqlcipher-vendored-openssl`, `Cargo.toml`); the key is applied with `PRAGMA key` from a zeroizing buffer (`store/mod.rs` `pragma_value`, `DbKey` is `ZeroizeOnDrop`). Tokens are never in the database (`engine/mod.rs` note on `engine_meta`).
- The key is generated from the OS CSPRNG and kept only in the credential store (`db_key.rs`), so a copied `keystone.db` is not readable without the user's OS keychain. On Windows the store is Credential Manager with local-machine persistence (`keychain.rs`, `Keychain::native`).
- A missing key does not silently create a new one over an existing database: the shell returns `STORE_KEY_INVALID` and the user decides (`bootstrap.rs`).
- `Secret` zeroes on drop and prints `<redacted>` (`auth/mod.rs`); the keychain record is serialized into a fixed `Zeroizing` buffer (`tokens.rs` `Bounded`).
- Sign-out revokes the token generation first, then wipes mirror, outbox, conflicts and engine state in one transaction (`engine/mod.rs` `finish_sign_out`, `engine/local.rs` `wipe`); an interrupted sign-out resumes and keeps access closed. `profile_remove` deletes the tokens, the DB key and the profile directory (`bootstrap.rs`: `tokens.remove_profile`, `db_keys.remove`, `remove_dir_all`; for the active profile it refuses while unsent outbox or conflict work exists unless forced).

Residual: an unlocked, logged-in session gives the thief the same access as the user, because the keychain opens for the OS user. The mirror is not wiped on idle, on a timer, or by a lock screen. `profiles.json` is plaintext (server URL, company id). Deleted rows are zeroed in the database file (`PRAGMA secure_delete = ON` on the writer), but the database is encrypted at rest anyway and older copies may remain in the WAL file until the next checkpoint, in freed disk blocks of the file system, and in SSD wear-levelling; this is not forensic erasure. The webview's own storage directory (WebView2 user data) is not audited.

### S4. Token replay or theft of a token

Mitigations (verified, mostly server side):
- Access tokens are short-lived (60 min) with the Sanctum ability `desktop` (`DeviceTokens::ABILITY`).
- Refresh tokens are stored hashed, rotate on use, and reuse of a spent token purges the whole device family (`DeviceTokens::rotate`: `used_at !== null` leads to `purge`). Refresh is rate limited per device.
- `auth_version`: every password or 2FA change bumps `users.auth_version` (`app/Models/User.php`); a refresh token issued under an older version kills the device family (`DeviceTokens::rotate`, `$row->auth_version !== $user->auth_version`), and a login that raced with the change fails (`DeviceTokens` mint under lock).
- Client side, a token is bound to its sign-in generation: results and retries from an older generation are discarded and cannot overwrite a newer sign-in (`client/http/proxy.rs`, `auth/mod.rs` compare-and-set).
- A 401 triggers at most one refresh and one retry (`proxy.rs`).

Residual: before the 60 minute expiry a stolen access token works from any machine; there is no device-bound proof (no DPoP, no mTLS). A same-user process can read the Credential Manager entry.

### S5. Remote sign-out and deactivation

Mitigations (verified):
- `AccessRevoker::revokeAll` deletes device rows and tokens and broadcasts `SessionRevoked` (`backend/app/Modules/Identity/Services/AccessRevoker.php`). The client receives `.session.revoked` over the realtime socket and forgets the tokens for that generation only (`src-tauri/src/realtime.rs`, ARCHITECTURE "Olaylar"). A deactivated user is refused refresh (`DeviceTokens::rotate` returns `'deactivated'`).
- The client treats `USER_DEACTIVATED` as terminal: it seals the local store and marks the generation deactivated with a compare-and-set that spares a later sign-in (`engine/mod.rs` around line 1215, `auth/mod.rs` `deactivate`). For a deactivation the seal removes the mirror, snapshots, the kept `/auth/me` answer, the outbox and the conflict records, in one transaction (`engine/local.rs` `seal(store, drop_work = true)`); unsent drafts are lost by design, because the user is deactivated. The store stays closed until the same identity is verified again. Company access loss (`COMPANY_FORBIDDEN`) removes the mirror but only seals the outbox and conflicts (`drop_work = false`): the user is still active and may regain access. The writer connection sets `PRAGMA secure_delete = ON` (`store/mod.rs`), so deleted rows are zeroed in the database file.
- If the user's sign-in is bound to the wrong identity (different user or company) the mirror is wiped before pushing (`engine/pass.rs`).
- `auth_devices_list` and `auth_devices_revoke` let the user revoke other devices.

Residual: all of this needs the client to talk to the server. An offline device keeps its data and its token until it next connects. Only a company-access-loss seal still retains the outbox and conflict records (sealed, unreadable until the same identity re-verifies). A `.session.revoked` event drops the tokens but does not wipe local data by itself (ARCHITECTURE); the wipe happens on the next run. A revoke cut off by a profile switch within 3 seconds can leave the token until the next 401 (ARCHITECTURE "Takip listesi", "Kesilen revoke").

### S6. Tampered build (there is no updater)

There is no auto-updater (`tauri-plugin-updater` is absent from `Cargo.toml`/`tauri.conf.json`) and no code signing. So there is no update channel to hijack, and also no way for a user to verify a binary.

Mitigations (verified):
- Release builds refuse a weakened CSP/config (build guard, above), and `KEYSTONE_DEV_ALLOW_HTTP` is ignored in release (`bootstrap::allow_http`).
- Dependency checks in CI: `cargo deny check`, `cargo audit` (`deny.toml`, ARCHITECTURE "Doğrulama").
- Devtools: the `tauri` crate is built without the `devtools` feature (`src-tauri/Cargo.toml`), so release webviews do not expose it by default.

Residual: anyone who can replace the binary on disk owns the user's session. Binaries are unsigned, so Windows SmartScreen will warn and integrity cannot be checked. This is accepted for a portfolio project.

### S7. IPC abuse (webview or injected script calling commands)

Mitigations (verified):
- Command surface is the fixed list in `lib.rs` `generate_handler!`; every command returns `Result<T, CommandError>` and validates input. `api_request` is the only data door, with method/path/header/body limits described in S1 and S2.
- The capability file is the only one, bound to `main`, with no `remote.urls`, so no remote origin can call commands (`capability_has_only_the_expected_keys` test).
- A second window cannot be created: `build_guard` rejects a config with other windows, and `on_new_window` denies. `tauri-plugin-single-instance` stops a second process opening the same keychain concurrently (`lib.rs`; the keychain has no cross-process lock).
- Idempotency keys are stored and replayed locally, and reuse of a key with a different request is rejected (`IDEMPOTENCY_KEY_REUSED`).

Residual: see S2. There is no per-command authorization or user confirmation; a destructive command such as `profile_remove` or `auth_sign_out` is available to any script that runs in the webview.

## Existing mitigations by code path

| Mitigation | Path |
|---|---|
| CSP | `desktop/src-tauri/tauri.conf.json` (`app.security.csp`) |
| CSP / config build gate | `desktop/src-tauri/build.rs`, `desktop/src-tauri/src/build_guard.rs` |
| Navigation and new-window lock | `desktop/src-tauri/src/lib.rs` |
| Capabilities | `desktop/src-tauri/capabilities/default.json` |
| Command list | `desktop/src-tauri/src/lib.rs` (`generate_handler!`) |
| Header allow-list, forbidden paths, body limit | `desktop/crates/keystone-sync/src/client/http/proxy.rs` |
| No redirects, https only, timeouts | `desktop/crates/keystone-sync/src/client/http.rs` (`build_http`) |
| Server URL validation | `desktop/crates/keystone-sync/src/client/url.rs` |
| Token record in keychain | `desktop/crates/keystone-secrets/src/tokens.rs`, `keychain.rs` |
| SQLCipher key | `desktop/crates/keystone-secrets/src/db_key.rs`, `desktop/crates/keystone-sync/src/store/mod.rs` |
| Sign-out, seal, wipe | `desktop/crates/keystone-sync/src/engine/mod.rs`, `engine/local.rs`, `engine/pass.rs` |
| Realtime revoke | `desktop/src-tauri/src/realtime.rs`, `desktop/crates/keystone-realtime/src/` |
| Log masking | `desktop/src-tauri/src/logging.rs` |
| Server: device tokens, `auth_version`, revocation | `backend/app/Modules/Identity/Services/DeviceTokens.php`, `AccessRevoker.php`, `backend/app/Models/User.php`, `backend/config/sanctum.php` |

## Residual risks

1. Same-user malware reads the Credential Manager entries (token and DB key) and the database. The OS keychain is the trust root.
2. Unlocked session on a stolen laptop: no idle lock, no re-authentication to open the app.
3. Stolen access token valid for up to 60 minutes; no device binding.
4. No certificate pinning; a user-installed or corporate root CA can intercept TLS.
5. Offline revocation gap: a deactivated or revoked device keeps its data and token until it reaches the server. A deactivation seal deletes the outbox and conflicts along with the mirror; only a company-access-loss seal keeps them sealed.
6. XSS keeps the user's authority over all registered commands (no network, no token read, but destructive commands are reachable).
7. No code signing, no update channel, no reproducible build: binary integrity is not verifiable.
8. `profiles.json` is plaintext; old copies of deleted rows can survive in the WAL, file-system blocks and SSD remapping despite `secure_delete`; WebView2's own user-data folder was not audited.
9. Memory: zeroization covers the key and token buffers in Rust, but a debugger or crash dump of a running process can still read secrets; memory is not locked against swapping.
10. Known open follow-ups from `ARCHITECTURE.md` "Takip listesi" (interrupted revoke, token absence in the webview after sign-in measured only by hand).

## Not in scope

Server-side hardening beyond the session endpoints, physical attacks on a running unlocked machine, supply chain beyond `cargo deny`/`cargo audit`, and any release, signing or hosting concern.
