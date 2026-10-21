<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Data;

use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;

/**
 * Decimal strings of the reports: numeric(20,4) values, always with four decimals.
 */
final class Money
{
    public static function of(mixed $value): BigDecimal
    {
        if ($value instanceof BigDecimal) {
            return $value->toScale(4, RoundingMode::HalfUp);
        }

        $text = is_string($value) || is_int($value) || is_float($value) ? (string) $value : '0';

        return BigDecimal::of($text === '' ? '0' : $text)->toScale(4, RoundingMode::HalfUp);
    }

    public static function str(BigDecimal $value): string
    {
        return (string) $value->toScale(4, RoundingMode::HalfUp);
    }

    /** Sum column of a database row (null when no row matched). */
    public static function col(?object $row, string $name): BigDecimal
    {
        return self::of($row === null ? null : ($row->{$name} ?? null));
    }
}
