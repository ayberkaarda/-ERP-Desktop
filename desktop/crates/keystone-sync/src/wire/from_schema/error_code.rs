// Produced by desktop/scripts/gen-wire.sh from contracts/sync. Do not edit by hand.

use serde::{Deserialize, Serialize};

/// Values of `errors.code` (`contracts/sync/error-codes.schema.json`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ErrorCode {
    /// 422. FormRequest doğrulaması veya alan değişmezi ihlali.
    #[serde(rename = "VALIDATION_ERROR")]
    ValidationError,
    /// 401. Token yok, süresi dolmuş veya iptal edilmiş (cihaz iptali dahil).
    #[serde(rename = "UNAUTHENTICATED")]
    Unauthenticated,
    /// 403. Policy veya izin reddi.
    #[serde(rename = "FORBIDDEN")]
    Forbidden,
    /// 404. Kayıt yok ya da şirket kapsamı dışında.
    #[serde(rename = "NOT_FOUND")]
    NotFound,
    /// 405.
    #[serde(rename = "METHOD_NOT_ALLOWED")]
    MethodNotAllowed,
    /// 429. Hız sınırı.
    #[serde(rename = "TOO_MANY_ATTEMPTS")]
    TooManyAttempts,
    /// 400. Alan kodu olmayan genel HTTP hatası.
    #[serde(rename = "HTTP_ERROR")]
    HttpError,
    /// 500.
    #[serde(rename = "SERVER_ERROR")]
    ServerError,
    /// 409. base_version güncel değil ve değişen alanlar kesişiyor.
    #[serde(rename = "VERSION_CONFLICT")]
    VersionConflict,
    /// 400.
    #[serde(rename = "IDEMPOTENCY_KEY_REQUIRED")]
    IdempotencyKeyRequired,
    /// 422. Aynı anahtar farklı içerikle yeniden kullanıldı.
    #[serde(rename = "IDEMPOTENCY_KEY_REUSED")]
    IdempotencyKeyReused,
    /// 409. Aynı anahtarlı istek hâlâ işleniyor.
    #[serde(rename = "IDEMPOTENCY_IN_PROGRESS")]
    IdempotencyInProgress,
    /// 400. X-Company-Id başlığı eksik.
    #[serde(rename = "COMPANY_REQUIRED")]
    CompanyRequired,
    /// 403. Kullanıcı şirketin üyesi değil.
    #[serde(rename = "COMPANY_FORBIDDEN")]
    CompanyForbidden,
    /// 401. POST /auth/device için TOTP gerekli.
    #[serde(rename = "TWO_FACTOR_REQUIRED")]
    TwoFactorRequired,
    /// 422.
    #[serde(rename = "INVALID_TWO_FACTOR_CODE")]
    InvalidTwoFactorCode,
    /// 403.
    #[serde(rename = "PASSWORD_CHANGE_REQUIRED")]
    PasswordChangeRequired,
    /// 403.
    #[serde(rename = "USER_DEACTIVATED")]
    UserDeactivated,
    /// 422. Belge durum makinesi geçişe izin vermiyor.
    #[serde(rename = "INVALID_STATE_TRANSITION")]
    InvalidStateTransition,
    /// 409.
    #[serde(rename = "APPROVAL_REQUIRED")]
    ApprovalRequired,
    /// 413.
    #[serde(rename = "FILE_TOO_LARGE")]
    FileTooLarge,
    /// 422.
    #[serde(rename = "UNSUPPORTED_FILE_TYPE")]
    UnsupportedFileType,
    /// Önerilen. 409. Hedef belge artık taslak değil. REST düzenleme/silme uçları da (bugünkü INVALID_STATE_TRANSITION yerine) bunu döner; push içinde conflict sonucu olarak döner.
    #[serde(rename = "DOCUMENT_LOCKED")]
    DocumentLocked,
    /// Önerilen. 409. Yeni cari, mevcut bir cariyle mükerrer adayı (vergi no / ad eşleşmesi). Push içinde conflict sonucu olarak döner.
    #[serde(rename = "DUPLICATE_RECORD")]
    DuplicateRecord,
    /// Önerilen. 409. İstemcinin schema_version değeri sunucunun desteklediği aralıkta değil; istemci güncellenmeli.
    #[serde(rename = "SYNC_SCHEMA_MISMATCH")]
    SyncSchemaMismatch,
    /// Önerilen. 422. Cursor biçimsiz ya da horizon'dan ileride.
    #[serde(rename = "SYNC_CURSOR_INVALID")]
    SyncCursorInvalid,
    /// Önerilen. 422. İstenen kaynak offline-manifest'te yok veya bu işlem için tanımlı değil.
    #[serde(rename = "SYNC_RESOURCE_UNSUPPORTED")]
    SyncResourceUnsupported,
    /// Önerilen. 422. Mutasyon offline-manifest'teki write tanımının dışında (ONLINE_ONLY işlem, izin verilmeyen alan değeri).
    #[serde(rename = "SYNC_OFFLINE_WRITE_NOT_ALLOWED")]
    SyncOfflineWriteNotAllowed,
    /// Önerilen. 413. Pull kaynak sayısı veya push mutasyon sayısı manifest limitini aşıyor.
    #[serde(rename = "SYNC_BATCH_TOO_LARGE")]
    SyncBatchTooLarge,
    /// Önerilen. Yalnızca push sonucu. Aynı kaydın önceki mutasyonu ya da depends_on ile bildirilen mutasyon applied/duplicate değil; bu mutasyon denenmedi.
    #[serde(rename = "SYNC_DEPENDENCY_FAILED")]
    SyncDependencyFailed,
    /// Önerilen. 422. Yalnızca push sonucu. base_version sunucudaki sürümden büyük; istemci durumu bozuk, kayıt yeniden indirilmeli.
    #[serde(rename = "SYNC_BASE_VERSION_AHEAD")]
    SyncBaseVersionAhead,
    /// Önerilen. 422. Yalnızca push sonucu. changed_fields, payload'ın üst düzey anahtar kümesine eşit değil.
    #[serde(rename = "SYNC_CHANGED_FIELDS_MISMATCH")]
    SyncChangedFieldsMismatch,
    /// Önerilen. 422. Yalnızca push sonucu. resolution, aynı kullanıcı/şirket/kayıt için saklanan bir conflict sonucuna karşılık gelmiyor ya da seçim o çakışma türünde geçersiz.
    #[serde(rename = "SYNC_RESOLUTION_INVALID")]
    SyncResolutionInvalid,
}

impl ErrorCode {
    /// Every code, in schema order.
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

    /// The wire spelling.
    pub const fn as_str(self) -> &'static str {
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
        }
    }

    /// HTTP status used when the code is returned at request level.
    /// `None` for codes that only appear inside push results.
    pub const fn http_status(self) -> Option<u16> {
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
        }
    }

    /// Marked "Önerilen" in the schema: added for sync, not yet in the server `ErrorCode`.
    pub const fn is_proposed(self) -> bool {
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
        }
    }
}

impl std::fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}
