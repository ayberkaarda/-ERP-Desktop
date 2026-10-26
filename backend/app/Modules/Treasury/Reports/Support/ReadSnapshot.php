<?php

declare(strict_types=1);

namespace App\Modules\Treasury\Reports\Support;

use Closure;
use Illuminate\Support\Facades\DB;

final class ReadSnapshot
{
    /**
     * @template T
     *
     * @param  Closure():T  $callback
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
