<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Reports\Support;

use App\Core\Money\RoundingPolicy;
use Brick\Math\BigDecimal;
use Brick\Math\BigNumber;
use Brick\Math\RoundingMode;

/**
 * Decimal text of the reports: money at scale 4 (values are whole cents), quantities at scale 6,
 * percentages at scale 2 (half up). Never floats.
 */
final class Num
{
    public static function dec(mixed $value): BigDecimal
    {
        return BigDecimal::of(is_string($value) || is_int($value) ? $value : '0');
    }

    public static function money(BigNumber $value): string
    {
        return (string) $value->toBigDecimal()->toScale(RoundingPolicy::MONEY_SCALE, RoundingMode::HalfUp);
    }

    public static function qty(BigNumber $value): string
    {
        return (string) $value->toBigDecimal()->toScale(RoundingPolicy::DECIMAL_SCALE, RoundingMode::HalfUp);
    }

    /** Rounded to cents (Core rounding policy). */
    public static function cents(BigNumber $value): BigDecimal
    {
        return RoundingPolicy::currency($value);
    }

    /** $part / $whole * 100 at scale 2, null when the whole is zero. */
    public static function percent(BigDecimal $part, BigDecimal $whole): ?string
    {
        if ($whole->isZero()) {
            return null;
        }

        return (string) $part->multipliedBy(100)->dividedBy($whole, 2, RoundingMode::HalfUp);
    }

    /** $amount / $quantity at scale 4, null when the quantity is zero. */
    public static function ratio(BigDecimal $amount, BigDecimal $quantity): ?string
    {
        return $quantity->isZero() ? null : (string) $amount->dividedBy($quantity, RoundingPolicy::MONEY_SCALE, RoundingMode::HalfUp);
    }

    public static function zero(): BigDecimal
    {
        return BigDecimal::zero();
    }
}
