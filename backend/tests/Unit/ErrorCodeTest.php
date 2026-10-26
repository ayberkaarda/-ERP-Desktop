<?php

declare(strict_types=1);

use App\Core\Http\ErrorCode;

it('maps http statuses to codes', function (int $status, ErrorCode $code): void {
    expect(ErrorCode::fromStatus($status))->toBe($code);
})->with([
    [401, ErrorCode::Unauthenticated],
    [403, ErrorCode::Forbidden],
    [404, ErrorCode::NotFound],
    [405, ErrorCode::MethodNotAllowed],
    [422, ErrorCode::ValidationError],
    [429, ErrorCode::TooManyAttempts],
    [409, ErrorCode::HttpError],
    [503, ErrorCode::ServerError],
]);

it('round-trips the generic codes through their status', function (ErrorCode $code): void {
    expect(ErrorCode::fromStatus($code->status()))->toBe($code);
})->with([
    ErrorCode::ValidationError,
    ErrorCode::Unauthenticated,
    ErrorCode::Forbidden,
    ErrorCode::NotFound,
    ErrorCode::MethodNotAllowed,
    ErrorCode::TooManyAttempts,
    ErrorCode::HttpError,
    ErrorCode::ServerError,
]);

it('uses the statuses promised by the phase 1 contract', function (ErrorCode $code, int $status): void {
    expect($code->status())->toBe($status);
})->with([
    [ErrorCode::VersionConflict, 409],
    [ErrorCode::IdempotencyKeyRequired, 400],
    [ErrorCode::IdempotencyKeyReused, 422],
    [ErrorCode::IdempotencyInProgress, 409],
    [ErrorCode::CompanyRequired, 400],
    [ErrorCode::CompanyForbidden, 403],
    [ErrorCode::TwoFactorRequired, 401],
    [ErrorCode::InvalidTwoFactorCode, 422],
    [ErrorCode::PasswordChangeRequired, 403],
    [ErrorCode::UserDeactivated, 403],
    [ErrorCode::InvalidStateTransition, 422],
    [ErrorCode::ApprovalRequired, 409],
    [ErrorCode::FileTooLarge, 413],
    [ErrorCode::UnsupportedFileType, 422],
]);

it('has a message for every code in every supported locale', function (string $locale): void {
    /** @var array<string, string> $messages */
    $messages = require dirname(__DIR__, 2)."/lang/{$locale}/errors.php";

    foreach (ErrorCode::cases() as $code) {
        expect($messages)->toHaveKey(strtolower($code->value));
    }

    expect(count($messages))->toBe(count(ErrorCode::cases()));
})->with(['en', 'tr', 'de', 'fr']);
