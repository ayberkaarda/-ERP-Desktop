<?php

declare(strict_types=1);

namespace App\Modules\Accounting\Support;

use App\Core\Company\CompanyContext;
use App\Modules\Accounting\Exceptions\LedgerViolation;
use Closure;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * Transaction helpers shared by the ledger services.
 */
final class Ledger
{
    /** Deferred constraint triggers that check booked entries. */
    public const string BALANCE_CONSTRAINTS = 'journal_lines_balanced, journal_entries_balanced';

    /**
     * Runs $fn in a transaction (a savepoint when nested) and turns trigger violations into 422s.
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
            $state = LedgerViolation::sqlState($e);

            throw $state === null ? $e : new LedgerViolation($state, $e);
        }
    }

    /**
     * Fires the deferred balance checks now, so a violation surfaces inside the service (as a 422)
     * instead of at a commit owned by an outer transaction; later writes stay deferred.
     */
    public static function checkBalances(): void
    {
        DB::statement('SET CONSTRAINTS '.self::BALANCE_CONSTRAINTS.' IMMEDIATE');
        DB::statement('SET CONSTRAINTS '.self::BALANCE_CONSTRAINTS.' DEFERRED');
    }

    /**
     * Lets the database accept postings into soft-closed periods for the rest of the transaction.
     */
    public static function allowSoftClosed(bool $allow): void
    {
        DB::select("select set_config('keystone.allow_soft_closed', ?, true)", [$allow ? 'on' : 'off']);
    }

    /**
     * Transaction-scoped advisory lock per active company and topic.
     */
    public static function lock(string $topic, ?string $companyId = null): void
    {
        $company = $companyId ?? app(CompanyContext::class)->id();
        DB::select('select pg_advisory_xact_lock(hashtext(?))', ['accounting.'.$topic.'.'.$company]);
    }
}
