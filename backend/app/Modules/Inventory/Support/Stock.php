<?php

declare(strict_types=1);

namespace App\Modules\Inventory\Support;

use App\Modules\Inventory\Exceptions\StockViolation;
use Brick\Math\BigDecimal;
use Brick\Math\BigNumber;
use Brick\Math\RoundingMode;
use Closure;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * Shared helpers: decimal arithmetic at the stock scales, the nil uuid sentinel and transactions
 * that turn trigger violations into 422s.
 */
final class Stock
{
    /** Stands for "no location" / "no lot" in the stock_balances key. */
    public const string NIL = '00000000-0000-0000-0000-000000000000';

    public const int QTY_SCALE = 6;

    public const int MONEY_SCALE = 4;

    /** Deferred constraint triggers of the stock tables. */
    public const string DEFERRED = 'stock_balances_not_negative';

    public static function dec(BigNumber|string|int|null $value): BigDecimal
    {
        return BigDecimal::of($value ?? '0');
    }

    public static function qty(BigNumber|string|int|null $value): string
    {
        return (string) self::dec($value)->toScale(self::QTY_SCALE, RoundingMode::HalfEven);
    }

    public static function money(BigNumber|string|int|null $value): BigDecimal
    {
        return self::dec($value)->toScale(self::MONEY_SCALE, RoundingMode::HalfEven);
    }

    public static function key(?string $id): string
    {
        return $id ?? self::NIL;
    }

    public static function nullable(?string $id): ?string
    {
        return $id === null || $id === self::NIL ? null : $id;
    }

    /**
     * Runs $fn in a transaction (a savepoint when nested) and turns stock trigger violations into 422s.
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
            $state = StockViolation::sqlState($e);

            throw $state === null ? $e : new StockViolation($state, $e);
        }
    }

    /** Fires the deferred negative-stock check now, so it surfaces inside the service. */
    public static function checkDeferred(): void
    {
        DB::statement('SET CONSTRAINTS '.self::DEFERRED.' IMMEDIATE');
        DB::statement('SET CONSTRAINTS '.self::DEFERRED.' DEFERRED');
    }

    /** Transaction-scoped advisory lock per company and topic. */
    public static function lock(string $companyId, string $topic): void
    {
        DB::select('select pg_advisory_xact_lock(hashtext(?))', ['inventory.'.$topic.'.'.$companyId]);
    }
}
