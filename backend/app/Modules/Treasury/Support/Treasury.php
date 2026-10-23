<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Support;

use App\Core\Money\RoundingPolicy;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Illuminate\Validation\ValidationException;

final class Treasury
{
    public static function decimal(string|int $value): BigDecimal
    {
        return BigDecimal::of($value);
    }

    public static function money(string|int|BigDecimal $value): string
    {
        return (string) BigDecimal::of($value)->toScale(4, RoundingMode::HalfUp);
    }

    public static function local(string|int|BigDecimal $value): string
    {
        return (string) RoundingPolicy::currency($value)->toScale(4);
    }

    public static function fail(string $field, string $key): never
    {
        throw ValidationException::withMessages([$field => [__('treasury::messages.'.$key)]]);
    }
}
