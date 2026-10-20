<?php

declare(strict_types=1);

namespace App\Core\Money;

use Brick\Math\BigDecimal;
use Brick\Math\BigNumber;
use Brick\Math\BigRational;
use Brick\Math\RoundingMode;
use InvalidArgumentException;

/**
 * Single source of scales and rounding. Floats are rejected everywhere.
 */
final class RoundingPolicy
{
    /** Stored money: numeric(20,4). */
    public const int MONEY_SCALE = 4;

    /** Stored qty, price, rate: numeric(20,6). */
    public const int DECIMAL_SCALE = 6;

    /** Document totals and tax per line, in minor currency units. */
    public const int CURRENCY_SCALE = 2;

    public const RoundingMode MODE = RoundingMode::HalfUp;

    public static function of(BigNumber|int|string $value): BigDecimal
    {
        return BigDecimal::of($value);
    }

    /**
     * @param  int<0, max>  $scale
     */
    public static function round(BigNumber|int|string $value, int $scale): BigDecimal
    {
        return self::of($value)->toScale($scale, self::MODE);
    }

    public static function money(BigNumber|int|string $value): BigDecimal
    {
        return self::round($value, self::MONEY_SCALE);
    }

    public static function decimal(BigNumber|int|string $value): BigDecimal
    {
        return self::round($value, self::DECIMAL_SCALE);
    }

    public static function currency(BigNumber|int|string $value): BigDecimal
    {
        return self::round($value, self::CURRENCY_SCALE);
    }

    /**
     * Splits $total over $weights so the parts sum exactly to the rounded total
     * (largest remainder; leftover cents go to the largest fractions first).
     *
     * @param  list<BigNumber|int|string>  $weights
     * @param  int<0, max>  $scale
     * @return list<BigDecimal>
     */
    public static function allocate(BigNumber|int|string $total, array $weights, int $scale = self::CURRENCY_SCALE): array
    {
        if ($weights === []) {
            throw new InvalidArgumentException('At least one weight is required.');
        }

        $total = self::round($total, $scale);
        $weights = array_map(self::of(...), $weights);
        $sum = array_reduce($weights, static fn (BigDecimal $c, BigDecimal $w): BigDecimal => $c->plus($w), BigDecimal::zero());

        if ($sum->isZero()) {
            throw new InvalidArgumentException('Weights must not sum to zero.');
        }

        $parts = [];
        $remainders = [];
        $allocated = BigDecimal::zero();

        foreach ($weights as $i => $weight) {
            // Exact rational share: decimal truncation could misorder nearly equal remainders.
            $exact = BigRational::of($total)->multipliedBy($weight)->dividedBy($sum);
            $part = $exact->toScale($scale, RoundingMode::Down);
            $parts[$i] = $part;
            $remainders[$i] = $exact->minus($part);
            $allocated = $allocated->plus($part);
        }

        $unit = BigDecimal::one()->withPointMovedLeft($scale);
        $left = $total->minus($allocated);
        $step = $left->isNegative() ? $unit->negated() : $unit;

        uasort($remainders, static fn (BigRational $a, BigRational $b): int => $b->abs()->compareTo($a->abs()));
        $order = array_keys($remainders);
        $n = 0;

        while (! $left->isZero()) {
            $i = $order[$n % count($order)];
            $parts[$i] = $parts[$i]->plus($step);
            $left = $left->minus($step);
            $n++;
        }

        return array_values($parts);
    }
}
