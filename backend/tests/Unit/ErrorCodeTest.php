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

it('round-trips its own status', function (ErrorCode $code): void {
    expect(ErrorCode::fromStatus($code->status()))->toBe($code);
})->with(ErrorCode::cases());
