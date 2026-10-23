<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Banking\Support;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Identity\Contracts\CompanyAuthorizer;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Illuminate\Validation\ValidationException;

final class Extension
{
    public static function company(): string
    {
        return app(CompanyContext::class)->id();
    }

    public static function authorize(string $permission): void
    {
        $user = request()->user();
        abort_unless($user instanceof User && app(CompanyAuthorizer::class)->allows($user, $permission, self::company()), 403);
    }

    public static function fail(string $field, string $key): never
    {
        throw ValidationException::withMessages([$field => [__('treasury-banking::messages.'.$key)]]);
    }

    public static function money(string|int $value): string
    {
        return (string) BigDecimal::of($value)->toScale(4, RoundingMode::HalfUp);
    }

    public static function date(string $value): string
    {
        $date = \DateTimeImmutable::createFromFormat('!Y-m-d', $value);
        if ($date === false || $date->format('Y-m-d') !== $value) {
            self::fail('date', 'invalid_date');
        }

        return $value;
    }
}
