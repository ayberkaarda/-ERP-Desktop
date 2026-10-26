//! Device login and refresh (`device-*.schema.json`). Secrets are redacted
//! from `Debug` output.

use std::fmt;

use serde::{Deserialize, Serialize};

use super::{Meta, Timestamp};

/// `POST /api/v1/auth/device` body.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeviceLoginRequest {
    pub email: String,
    pub password: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "super::serde_util::double_option"
    )]
    pub two_factor_code: Option<Option<String>>,
    pub device_name: String,
    pub fingerprint: String,
}

impl fmt::Debug for DeviceLoginRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DeviceLoginRequest")
            .field("email", &self.email)
            .field("password", &"<redacted>")
            .field(
                "two_factor_code",
                &self.two_factor_code.as_ref().map(|_| "<redacted>"),
            )
            .field("device_name", &self.device_name)
            .field("fingerprint", &self.fingerprint)
            .finish()
    }
}

/// `POST /api/v1/auth/device/refresh` body.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeviceRefreshRequest {
    pub refresh_token: String,
}

impl fmt::Debug for DeviceRefreshRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DeviceRefreshRequest")
            .field("refresh_token", &"<redacted>")
            .finish()
    }
}

/// Success body of both device login and refresh.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceTokenResponse {
    pub data: DeviceToken,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<Meta>,
}

/// Access token (60 min) and single-use refresh token (sliding 30 days).
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceToken {
    pub token: String,
    pub expires_at: Timestamp,
    pub refresh_token: String,
    pub refresh_expires_at: Timestamp,
}

impl fmt::Debug for DeviceToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DeviceToken")
            .field("token", &"<redacted>")
            .field("expires_at", &self.expires_at)
            .field("refresh_token", &"<redacted>")
            .field("refresh_expires_at", &self.refresh_expires_at)
            .finish()
    }
}
