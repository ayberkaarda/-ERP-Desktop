<?php

declare(strict_types=1);

namespace App\Modules\Parties\Support;

use Closure;
use Illuminate\Database\ConnectionInterface;

/**
 * Runs an export (row count check plus reading) in one REPEATABLE READ transaction, so the cap is
 * checked against exactly the rows that are written. Nested in an outer transaction the isolation
 * level cannot change any more; the outer transaction's snapshot rules apply.
 */
final class ExportSnapshot
{
    public function __construct(private readonly ConnectionInterface $db) {}

    /**
     * @template T
     *
     * @param  Closure(): T  $callback
     * @return T
     */
    public function run(Closure $callback): mixed
    {
        $outermost = $this->db->transactionLevel() === 0;

        return $this->db->transaction(function () use ($callback, $outermost): mixed {
            if ($outermost) {
                $this->db->statement('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
            }

            return $callback();
        });
    }
}
