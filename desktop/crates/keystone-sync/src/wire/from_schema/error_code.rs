// Produced by desktop/scripts/gen-wire.sh from contracts/sync. Do not edit by hand.

use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Values of `errors.code` (`contracts/sync/error-codes.schema.json`).
///
/// A code missing from the schema (a newer server) decodes to [`ErrorCode::Unknown`]
/// instead of failing, and counts as a generic server error.
#[derive(Clone, PartialEq, Eq, Hash)]
pub enum ErrorCode {
    /// 422. FormRequest doğrulaması veya alan değişmezi ihlali.
    ///
    /// Wire: `VALIDATION_ERROR`.
    ValidationError,
    /// 401. Token yok, süresi dolmuş veya iptal edilmiş (cihaz iptali dahil).
    ///
    /// Wire: `UNAUTHENTICATED`.
    Unauthenticated,
    /// 403. Policy veya izin reddi.
    ///
    /// Wire: `FORBIDDEN`.
    Forbidden,
    /// 404. Kayıt yok ya da şirket kapsamı dışında.
    ///
    /// Wire: `NOT_FOUND`.
    NotFound,
    /// 405.
    ///
    /// Wire: `METHOD_NOT_ALLOWED`.
    MethodNotAllowed,
    /// 429. Hız sınırı.
    ///
    /// Wire: `TOO_MANY_ATTEMPTS`.
    TooManyAttempts,
    /// 400. Alan kodu olmayan genel HTTP hatası.
    ///
    /// Wire: `HTTP_ERROR`.
    HttpError,
    /// 500.
    ///
    /// Wire: `SERVER_ERROR`.
    ServerError,
    /// 409. base_version güncel değil ve değişen alanlar kesişiyor.
    ///
    /// Wire: `VERSION_CONFLICT`.
    VersionConflict,
    /// 400.
    ///
    /// Wire: `IDEMPOTENCY_KEY_REQUIRED`.
    IdempotencyKeyRequired,
    /// 422. Aynı anahtar farklı içerikle yeniden kullanıldı.
    ///
    /// Wire: `IDEMPOTENCY_KEY_REUSED`.
    IdempotencyKeyReused,
    /// 409. Aynı anahtarlı istek hâlâ işleniyor.
    ///
    /// Wire: `IDEMPOTENCY_IN_PROGRESS`.
    IdempotencyInProgress,
    /// 400. X-Company-Id başlığı eksik.
    ///
    /// Wire: `COMPANY_REQUIRED`.
    CompanyRequired,
    /// 403. Kullanıcı şirketin üyesi değil.
    ///
    /// Wire: `COMPANY_FORBIDDEN`.
    CompanyForbidden,
    /// 401. POST /auth/device için TOTP gerekli.
    ///
    /// Wire: `TWO_FACTOR_REQUIRED`.
    TwoFactorRequired,
    /// 422.
    ///
    /// Wire: `INVALID_TWO_FACTOR_CODE`.
    InvalidTwoFactorCode,
    /// 403.
    ///
    /// Wire: `PASSWORD_CHANGE_REQUIRED`.
    PasswordChangeRequired,
    /// 403.
    ///
    /// Wire: `USER_DEACTIVATED`.
    UserDeactivated,
    /// 422. Belge durum makinesi geçişe izin vermiyor.
    ///
    /// Wire: `INVALID_STATE_TRANSITION`.
    InvalidStateTransition,
    /// 409.
    ///
    /// Wire: `APPROVAL_REQUIRED`.
    ApprovalRequired,
    /// 413.
    ///
    /// Wire: `FILE_TOO_LARGE`.
    FileTooLarge,
    /// 422.
    ///
    /// Wire: `UNSUPPORTED_FILE_TYPE`.
    UnsupportedFileType,
    /// Önerilen. 409. Hedef belge artık taslak değil. REST düzenleme/silme uçları da (bugünkü INVALID_STATE_TRANSITION yerine) bunu döner; push içinde conflict sonucu olarak döner.
    ///
    /// Wire: `DOCUMENT_LOCKED`.
    DocumentLocked,
    /// Önerilen. 409. Yeni cari, mevcut bir cariyle mükerrer adayı (vergi no / ad eşleşmesi). Push içinde conflict sonucu olarak döner.
    ///
    /// Wire: `DUPLICATE_RECORD`.
    DuplicateRecord,
    /// Önerilen. 409. İstemcinin schema_version değeri sunucunun desteklediği aralıkta değil; istemci güncellenmeli.
    ///
    /// Wire: `SYNC_SCHEMA_MISMATCH`.
    SyncSchemaMismatch,
    /// Önerilen. 422. Cursor biçimsiz ya da horizon'dan ileride.
    ///
    /// Wire: `SYNC_CURSOR_INVALID`.
    SyncCursorInvalid,
    /// Önerilen. 422. İstenen kaynak offline-manifest'te yok veya bu işlem için tanımlı değil.
    ///
    /// Wire: `SYNC_RESOURCE_UNSUPPORTED`.
    SyncResourceUnsupported,
    /// Önerilen. 422. Mutasyon offline-manifest'teki write tanımının dışında (ONLINE_ONLY işlem, izin verilmeyen alan değeri).
    ///
    /// Wire: `SYNC_OFFLINE_WRITE_NOT_ALLOWED`.
    SyncOfflineWriteNotAllowed,
    /// Önerilen. 413. Pull kaynak sayısı veya push mutasyon sayısı manifest limitini aşıyor.
    ///
    /// Wire: `SYNC_BATCH_TOO_LARGE`.
    SyncBatchTooLarge,
    /// Önerilen. Yalnızca push sonucu. Aynı kaydın önceki mutasyonu ya da depends_on ile bildirilen mutasyon applied/duplicate değil; bu mutasyon denenmedi.
    ///
    /// Wire: `SYNC_DEPENDENCY_FAILED`.
    SyncDependencyFailed,
    /// Önerilen. 422. Yalnızca push sonucu. base_version sunucudaki sürümden büyük; istemci durumu bozuk, kayıt yeniden indirilmeli.
    ///
    /// Wire: `SYNC_BASE_VERSION_AHEAD`.
    SyncBaseVersionAhead,
    /// Önerilen. 422. Yalnızca push sonucu. changed_fields, payload'ın üst düzey anahtar kümesine eşit değil.
    ///
    /// Wire: `SYNC_CHANGED_FIELDS_MISMATCH`.
    SyncChangedFieldsMismatch,
    /// Önerilen. 422. Yalnızca push sonucu. resolution, aynı kullanıcı/şirket/kayıt için saklanan bir conflict sonucuna karşılık gelmiyor ya da seçim o çakışma türünde geçersiz.
    ///
    /// Wire: `SYNC_RESOLUTION_INVALID`.
    SyncResolutionInvalid,
    /// A code this client does not know, kept verbatim.
    Unknown(String),
}

impl ErrorCode {
    /// Every known code, in schema order.
    pub const ALL: &[Self] = &[
        Self::ValidationError,
        Self::Unauthenticated,
        Self::Forbidden,
        Self::NotFound,
        Self::MethodNotAllowed,
        Self::TooManyAttempts,
        Self::HttpError,
        Self::ServerError,
        Self::VersionConflict,
        Self::IdempotencyKeyRequired,
        Self::IdempotencyKeyReused,
        Self::IdempotencyInProgress,
        Self::CompanyRequired,
        Self::CompanyForbidden,
        Self::TwoFactorRequired,
        Self::InvalidTwoFactorCode,
        Self::PasswordChangeRequired,
        Self::UserDeactivated,
        Self::InvalidStateTransition,
        Self::ApprovalRequired,
        Self::FileTooLarge,
        Self::UnsupportedFileType,
        Self::DocumentLocked,
        Self::DuplicateRecord,
        Self::SyncSchemaMismatch,
        Self::SyncCursorInvalid,
        Self::SyncResourceUnsupported,
        Self::SyncOfflineWriteNotAllowed,
        Self::SyncBatchTooLarge,
        Self::SyncDependencyFailed,
        Self::SyncBaseVersionAhead,
        Self::SyncChangedFieldsMismatch,
        Self::SyncResolutionInvalid,
    ];

    /// Parses a wire code; anything unknown becomes [`ErrorCode::Unknown`].
    pub fn from_wire(code: &str) -> Self {
        match code {
            "VALIDATION_ERROR" => Self::ValidationError,
            "UNAUTHENTICATED" => Self::Unauthenticated,
            "FORBIDDEN" => Self::Forbidden,
            "NOT_FOUND" => Self::NotFound,
            "METHOD_NOT_ALLOWED" => Self::MethodNotAllowed,
            "TOO_MANY_ATTEMPTS" => Self::TooManyAttempts,
            "HTTP_ERROR" => Self::HttpError,
            "SERVER_ERROR" => Self::ServerError,
            "VERSION_CONFLICT" => Self::VersionConflict,
            "IDEMPOTENCY_KEY_REQUIRED" => Self::IdempotencyKeyRequired,
            "IDEMPOTENCY_KEY_REUSED" => Self::IdempotencyKeyReused,
            "IDEMPOTENCY_IN_PROGRESS" => Self::IdempotencyInProgress,
            "COMPANY_REQUIRED" => Self::CompanyRequired,
            "COMPANY_FORBIDDEN" => Self::CompanyForbidden,
            "TWO_FACTOR_REQUIRED" => Self::TwoFactorRequired,
            "INVALID_TWO_FACTOR_CODE" => Self::InvalidTwoFactorCode,
            "PASSWORD_CHANGE_REQUIRED" => Self::PasswordChangeRequired,
            "USER_DEACTIVATED" => Self::UserDeactivated,
            "INVALID_STATE_TRANSITION" => Self::InvalidStateTransition,
            "APPROVAL_REQUIRED" => Self::ApprovalRequired,
            "FILE_TOO_LARGE" => Self::FileTooLarge,
            "UNSUPPORTED_FILE_TYPE" => Self::UnsupportedFileType,
            "DOCUMENT_LOCKED" => Self::DocumentLocked,
            "DUPLICATE_RECORD" => Self::DuplicateRecord,
            "SYNC_SCHEMA_MISMATCH" => Self::SyncSchemaMismatch,
            "SYNC_CURSOR_INVALID" => Self::SyncCursorInvalid,
            "SYNC_RESOURCE_UNSUPPORTED" => Self::SyncResourceUnsupported,
            "SYNC_OFFLINE_WRITE_NOT_ALLOWED" => Self::SyncOfflineWriteNotAllowed,
            "SYNC_BATCH_TOO_LARGE" => Self::SyncBatchTooLarge,
            "SYNC_DEPENDENCY_FAILED" => Self::SyncDependencyFailed,
            "SYNC_BASE_VERSION_AHEAD" => Self::SyncBaseVersionAhead,
            "SYNC_CHANGED_FIELDS_MISMATCH" => Self::SyncChangedFieldsMismatch,
            "SYNC_RESOLUTION_INVALID" => Self::SyncResolutionInvalid,
            other => Self::Unknown(other.to_owned()),
        }
    }

    /// The wire spelling (the original text for [`ErrorCode::Unknown`]).
    pub fn as_str(&self) -> &str {
        match self {
            Self::Unknown(code) => code,
            known => known.ui_code(),
        }
    }

    /// Code the UI translates: the wire spelling, or `SERVER_ERROR` for an unknown code.
    pub const fn ui_code(&self) -> &'static str {
        match self {
            Self::ValidationError => "VALIDATION_ERROR",
            Self::Unauthenticated => "UNAUTHENTICATED",
            Self::Forbidden => "FORBIDDEN",
            Self::NotFound => "NOT_FOUND",
            Self::MethodNotAllowed => "METHOD_NOT_ALLOWED",
            Self::TooManyAttempts => "TOO_MANY_ATTEMPTS",
            Self::HttpError => "HTTP_ERROR",
            Self::ServerError => "SERVER_ERROR",
            Self::VersionConflict => "VERSION_CONFLICT",
            Self::IdempotencyKeyRequired => "IDEMPOTENCY_KEY_REQUIRED",
            Self::IdempotencyKeyReused => "IDEMPOTENCY_KEY_REUSED",
            Self::IdempotencyInProgress => "IDEMPOTENCY_IN_PROGRESS",
            Self::CompanyRequired => "COMPANY_REQUIRED",
            Self::CompanyForbidden => "COMPANY_FORBIDDEN",
            Self::TwoFactorRequired => "TWO_FACTOR_REQUIRED",
            Self::InvalidTwoFactorCode => "INVALID_TWO_FACTOR_CODE",
            Self::PasswordChangeRequired => "PASSWORD_CHANGE_REQUIRED",
            Self::UserDeactivated => "USER_DEACTIVATED",
            Self::InvalidStateTransition => "INVALID_STATE_TRANSITION",
            Self::ApprovalRequired => "APPROVAL_REQUIRED",
            Self::FileTooLarge => "FILE_TOO_LARGE",
            Self::UnsupportedFileType => "UNSUPPORTED_FILE_TYPE",
            Self::DocumentLocked => "DOCUMENT_LOCKED",
            Self::DuplicateRecord => "DUPLICATE_RECORD",
            Self::SyncSchemaMismatch => "SYNC_SCHEMA_MISMATCH",
            Self::SyncCursorInvalid => "SYNC_CURSOR_INVALID",
            Self::SyncResourceUnsupported => "SYNC_RESOURCE_UNSUPPORTED",
            Self::SyncOfflineWriteNotAllowed => "SYNC_OFFLINE_WRITE_NOT_ALLOWED",
            Self::SyncBatchTooLarge => "SYNC_BATCH_TOO_LARGE",
            Self::SyncDependencyFailed => "SYNC_DEPENDENCY_FAILED",
            Self::SyncBaseVersionAhead => "SYNC_BASE_VERSION_AHEAD",
            Self::SyncChangedFieldsMismatch => "SYNC_CHANGED_FIELDS_MISMATCH",
            Self::SyncResolutionInvalid => "SYNC_RESOLUTION_INVALID",
            Self::Unknown(_) => "SERVER_ERROR",
        }
    }

    /// False only for [`ErrorCode::Unknown`].
    pub const fn is_known(&self) -> bool {
        !matches!(self, Self::Unknown(_))
    }

    /// HTTP status used when the code is returned at request level.
    /// `None` for codes that only appear inside push results, and for unknown codes.
    pub const fn http_status(&self) -> Option<u16> {
        match self {
            Self::ValidationError => Some(422),
            Self::Unauthenticated => Some(401),
            Self::Forbidden => Some(403),
            Self::NotFound => Some(404),
            Self::MethodNotAllowed => Some(405),
            Self::TooManyAttempts => Some(429),
            Self::HttpError => Some(400),
            Self::ServerError => Some(500),
            Self::VersionConflict => Some(409),
            Self::IdempotencyKeyRequired => Some(400),
            Self::IdempotencyKeyReused => Some(422),
            Self::IdempotencyInProgress => Some(409),
            Self::CompanyRequired => Some(400),
            Self::CompanyForbidden => Some(403),
            Self::TwoFactorRequired => Some(401),
            Self::InvalidTwoFactorCode => Some(422),
            Self::PasswordChangeRequired => Some(403),
            Self::UserDeactivated => Some(403),
            Self::InvalidStateTransition => Some(422),
            Self::ApprovalRequired => Some(409),
            Self::FileTooLarge => Some(413),
            Self::UnsupportedFileType => Some(422),
            Self::DocumentLocked => Some(409),
            Self::DuplicateRecord => Some(409),
            Self::SyncSchemaMismatch => Some(409),
            Self::SyncCursorInvalid => Some(422),
            Self::SyncResourceUnsupported => Some(422),
            Self::SyncOfflineWriteNotAllowed => Some(422),
            Self::SyncBatchTooLarge => Some(413),
            Self::SyncDependencyFailed => None,
            Self::SyncBaseVersionAhead => Some(422),
            Self::SyncChangedFieldsMismatch => Some(422),
            Self::SyncResolutionInvalid => Some(422),
            Self::Unknown(_) => None,
        }
    }

    /// Marked "Önerilen" in the schema: added for sync, not yet in the server `ErrorCode`.
    pub const fn is_proposed(&self) -> bool {
        match self {
            Self::ValidationError => false,
            Self::Unauthenticated => false,
            Self::Forbidden => false,
            Self::NotFound => false,
            Self::MethodNotAllowed => false,
            Self::TooManyAttempts => false,
            Self::HttpError => false,
            Self::ServerError => false,
            Self::VersionConflict => false,
            Self::IdempotencyKeyRequired => false,
            Self::IdempotencyKeyReused => false,
            Self::IdempotencyInProgress => false,
            Self::CompanyRequired => false,
            Self::CompanyForbidden => false,
            Self::TwoFactorRequired => false,
            Self::InvalidTwoFactorCode => false,
            Self::PasswordChangeRequired => false,
            Self::UserDeactivated => false,
            Self::InvalidStateTransition => false,
            Self::ApprovalRequired => false,
            Self::FileTooLarge => false,
            Self::UnsupportedFileType => false,
            Self::DocumentLocked => true,
            Self::DuplicateRecord => true,
            Self::SyncSchemaMismatch => true,
            Self::SyncCursorInvalid => true,
            Self::SyncResourceUnsupported => true,
            Self::SyncOfflineWriteNotAllowed => true,
            Self::SyncBatchTooLarge => true,
            Self::SyncDependencyFailed => true,
            Self::SyncBaseVersionAhead => true,
            Self::SyncChangedFieldsMismatch => true,
            Self::SyncResolutionInvalid => true,
            Self::Unknown(_) => false,
        }
    }
}

/// `SCREAMING_SNAKE_CASE`, at most 64 bytes: safe to show.
fn is_code_shaped(code: &str) -> bool {
    code.len() <= 64
        && code.bytes().next().is_some_and(|b| b.is_ascii_uppercase())
        && code
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
}

/// An unknown code is shown only when it looks like a code: server text
/// in that position could carry anything.
impl std::fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unknown(code) if !is_code_shaped(code) => f.write_str("<redacted>"),
            other => f.write_str(other.as_str()),
        }
    }
}

impl std::fmt::Debug for ErrorCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unknown(code) if is_code_shaped(code) => write!(f, "Unknown({code:?})"),
            Self::Unknown(_) => f.write_str("Unknown(<redacted>)"),
            known => f.write_str(known.ui_code()),
        }
    }
}

impl Serialize for ErrorCode {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for ErrorCode {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        String::deserialize(deserializer).map(|code| Self::from_wire(&code))
    }
}
