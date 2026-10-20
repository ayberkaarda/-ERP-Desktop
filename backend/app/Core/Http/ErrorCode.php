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

    public function status(): int
    {
        return match ($this) {
            self::ValidationError => 422,
            self::Unauthenticated => 401,
            self::Forbidden => 403,
            self::NotFound => 404,
            self::MethodNotAllowed => 405,
            self::TooManyAttempts => 429,
            self::HttpError => 400,
            self::ServerError => 500,
        };
    }

    public function message(): string
    {
        $key = 'errors.'.strtolower($this->value);
        $message = __($key);

        return is_string($message) ? $message : $key;
    }

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
