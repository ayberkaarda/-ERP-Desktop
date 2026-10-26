<?php

declare(strict_types=1);

namespace App\Core\Http;

/**
 * Machine-readable error codes shared with clients through OpenAPI.
 */
enum ErrorCode: string
{
    case ValidationError = 'VALIDATION_ERROR';
    case Unauthenticated = 'UNAUTHENTICATED';
    case Forbidden = 'FORBIDDEN';
    case NotFound = 'NOT_FOUND';
    case MethodNotAllowed = 'METHOD_NOT_ALLOWED';
    case TooManyAttempts = 'TOO_MANY_ATTEMPTS';
    case HttpError = 'HTTP_ERROR';
    case ServerError = 'SERVER_ERROR';
    case VersionConflict = 'VERSION_CONFLICT';
    case IdempotencyKeyRequired = 'IDEMPOTENCY_KEY_REQUIRED';
    case IdempotencyKeyReused = 'IDEMPOTENCY_KEY_REUSED';
    case IdempotencyInProgress = 'IDEMPOTENCY_IN_PROGRESS';
    case CompanyRequired = 'COMPANY_REQUIRED';
    case CompanyForbidden = 'COMPANY_FORBIDDEN';
    case TwoFactorRequired = 'TWO_FACTOR_REQUIRED';
    case InvalidTwoFactorCode = 'INVALID_TWO_FACTOR_CODE';
    case PasswordChangeRequired = 'PASSWORD_CHANGE_REQUIRED';
    case UserDeactivated = 'USER_DEACTIVATED';
    case InvalidStateTransition = 'INVALID_STATE_TRANSITION';
    case ApprovalRequired = 'APPROVAL_REQUIRED';
    case FileTooLarge = 'FILE_TOO_LARGE';
    case UnsupportedFileType = 'UNSUPPORTED_FILE_TYPE';

    public function status(): int
    {
        return match ($this) {
            self::ValidationError,
            self::IdempotencyKeyReused,
            self::InvalidTwoFactorCode,
            self::InvalidStateTransition,
            self::UnsupportedFileType => 422,
            self::Unauthenticated,
            self::TwoFactorRequired => 401,
            self::Forbidden,
            self::CompanyForbidden,
            self::PasswordChangeRequired,
            self::UserDeactivated => 403,
            self::NotFound => 404,
            self::MethodNotAllowed => 405,
            self::VersionConflict,
            self::IdempotencyInProgress,
            self::ApprovalRequired => 409,
            self::FileTooLarge => 413,
            self::TooManyAttempts => 429,
            self::HttpError,
            self::IdempotencyKeyRequired,
            self::CompanyRequired => 400,
            self::ServerError => 500,
        };
    }

    public function message(): string
    {
        $key = 'errors.'.strtolower($this->value);
        $message = __($key);

        return is_string($message) ? $message : $key;
    }

    /**
     * Generic fallback for HTTP exceptions that carry no domain code.
     */
    public static function fromStatus(int $status): self
    {
        return match (true) {
            $status === 401 => self::Unauthenticated,
            $status === 403 => self::Forbidden,
            $status === 404 => self::NotFound,
            $status === 405 => self::MethodNotAllowed,
            $status === 422 => self::ValidationError,
            $status === 429 => self::TooManyAttempts,
            $status >= 500 => self::ServerError,
            default => self::HttpError,
        };
    }
}
