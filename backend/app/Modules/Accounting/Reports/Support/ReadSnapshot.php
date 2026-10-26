<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Reports\Support;

use Closure;
use Illuminate\Support\Facades\DB;

/**
 * Runs a report in one REPEATABLE READ, READ ONLY transaction, so opening balance, lines, totals and
 * the export row count all see the same postings. Nested in an outer transaction the isolation level
 * cannot change any more; the outer transaction's snapshot rules apply.
 */
final class ReadSnapshot
{
    /**
     * @template T
     *
     * @param  Closure(): T  $callback
     * @return T
     */
    public static function run(Closure $callback): mixed
    {
        $outermost = DB::transactionLevel() === 0;

        return DB::transaction(function () use ($callback, $outermost): mixed {
            if ($outermost) {
                DB::statement('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
            }

            return $callback();
        });
    }
}
