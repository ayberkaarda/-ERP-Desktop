<?php

declare(strict_types=1);

namespace App\Modules\Purchasing\Support;

use App\Core\Money\RoundingPolicy;
use App\Modules\Purchasing\Exceptions\PurchasingViolation;
use Brick\Math\BigDecimal;
use Brick\Math\BigNumber;
use Brick\Math\RoundingMode;
use Closure;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * Shared helpers: decimals at the module scales and transactions that turn trigger violations into 422s.
 */
final class Purchasing
{
    public static function dec(BigNumber|string|int|null $value): BigDecimal
    {
        return BigDecimal::of($value ?? '0');
    }

    public static function qty(BigNumber|string|int|null $value): string
    {
        return (string) self::dec($value)->toScale(RoundingPolicy::DECIMAL_SCALE, RoundingMode::HalfUp);
    }

    public static function money(BigNumber|string|int|null $value): string
    {
        return (string) self::dec($value)->toScale(RoundingPolicy::MONEY_SCALE, RoundingMode::HalfUp);
    }

    public static function min(BigDecimal $a, BigDecimal $b): BigDecimal
    {
        return $a->isLessThan($b) ? $a : $b;
    }

    public static function max(BigDecimal $a, BigDecimal $b): BigDecimal
    {
        return $a->isGreaterThan($b) ? $a : $b;
    }

    /**
     * Runs $fn in a transaction (a savepoint when nested) and turns purchasing database violations into 422s.
     *
     * @template T
     *
     * @param  Closure(): T  $fn
     * @return T
     */
    public static function transaction(Closure $fn): mixed
    {
        try {
            return DB::transaction($fn);
        } catch (QueryException $e) {
            $state = PurchasingViolation::sqlState($e);

            throw $state === null ? $e : new PurchasingViolation($state, $e);
        }
    }

    /** Transaction-scoped advisory lock per company and topic. */
    public static function lock(string $companyId, string $topic): void
    {
        DB::select('select pg_advisory_xact_lock(hashtext(?))', ['purchasing.'.$topic.'.'.$companyId]);
    }
}
