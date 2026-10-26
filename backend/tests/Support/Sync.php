<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Core\Sync\Xid8;
use App\Models\User;
use App\Modules\Identity\Services\DeviceTokens;
use App\Modules\Organization\Models\Company;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Helpers for sync tests.
 *
 * Pull reads only rows below the horizon, pg_snapshot_xmin(pg_current_snapshot()). A row
 * written inside RefreshDatabase's wrapping transaction carries that transaction's xid, which
 * the horizon can never pass, so pull tests would see nothing. Sync read tests therefore use
 * Tests\Fixtures\Sync\SyncDatabase (committing DatabaseTruncation) instead of RefreshDatabase.
 * Write-only tests (push outcomes, idempotency) may keep RefreshDatabase.
 */
final class Sync
{
    public const string FINGERPRINT = 'fp-sync-desktop-0001';

    /**
     * Bearer headers of a desktop device token (ability `desktop`), as the desktop app sends them.
     *
     * @return array<string, string>
     */
    public static function deviceHeaders(User $user, ?Company $company = null, string $fingerprint = self::FINGERPRINT): array
    {
        $issued = app(DeviceTokens::class)->issue($user, Request::create('/'), 'Sync test device', $fingerprint);
        Identity::fresh();

        $headers = ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$issued['token']];

        if ($company !== null) {
            $headers['X-Company-Id'] = $company->id;
        }

        return $headers;
    }

    /**
     * Bearer headers of a plain (non-desktop) personal access token, for 403 tests.
     *
     * @return array<string, string>
     */
    public static function webTokenHeaders(User $user, ?Company $company = null): array
    {
        $token = $user->createToken('web', ['*'])->plainTextToken;
        $headers = ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$token];

        if ($company !== null) {
            $headers['X-Company-Id'] = $company->id;
        }

        return $headers;
    }

    /**
     * Current pull horizon: every transaction below it has finished.
     */
    public static function horizon(): Xid8
    {
        return Xid8::of(self::scalar('SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS v'));
    }

    /**
     * Waits until the horizon has passed $txid, i.e. a pull would deliver what that transaction
     * wrote. The horizon is cluster wide: an open transaction in any database of the server
     * (another test lane, a psql session) holds it back, so tests wait instead of asserting
     * at once.
     */
    public static function awaitHorizonPast(Xid8 $txid, float $timeoutSeconds = 30.0): Xid8
    {
        $deadline = microtime(true) + $timeoutSeconds;

        do {
            $horizon = self::horizon();

            if ($horizon->greaterThan($txid)) {
                return $horizon;
            }

            usleep(50_000);
        } while (microtime(true) < $deadline);

        throw new RuntimeException("Horizon {$horizon} did not pass {$txid} within {$timeoutSeconds}s; a long transaction is open on the server.");
    }

    /**
     * xid8 of the running transaction (assigns one if none yet).
     */
    public static function currentTxid(): Xid8
    {
        return Xid8::of(self::scalar('SELECT pg_current_xact_id()::text AS v'));
    }

    public static function txidOf(string $table, string $id): Xid8
    {
        $row = DB::table($table)->where('id', $id)->selectRaw('sync_txid::text AS v')->first();

        if (! is_object($row) || ! is_string($row->v ?? null)) {
            throw new RuntimeException("No {$table} row {$id}.");
        }

        return Xid8::of($row->v);
    }

    /**
     * @return object{resource_table: string, row_id: string, company_id: string|null, parent_id: string|null, sync_txid: string, reason: string, deleted_at: string}|null
     */
    public static function tombstone(string $table, string $id): ?object
    {
        $row = DB::table('sync_tombstones')
            ->where('resource_table', $table)
            ->where('row_id', $id)
            ->selectRaw('resource_table, row_id, company_id, parent_id, sync_txid::text AS sync_txid, reason, deleted_at')
            ->first();

        /** @var object{resource_table: string, row_id: string, company_id: string|null, parent_id: string|null, sync_txid: string, reason: string, deleted_at: string}|null $row */
        return $row;
    }

    /**
     * Ids of the table's rows a pull at this moment could deliver (sync_txid below the horizon).
     *
     * @return list<string>
     */
    public static function belowHorizon(string $table): array
    {
        /** @var list<string> */
        return DB::table($table)
            ->whereRaw('sync_txid < pg_snapshot_xmin(pg_current_snapshot())')
            ->orderByRaw('sync_txid, id')
            ->pluck('id')
            ->all();
    }

    private static function scalar(string $sql): string
    {
        $row = DB::selectOne($sql);

        if (! is_object($row) || ! is_string($row->v ?? null)) {
            throw new RuntimeException("Query returned no value: {$sql}");
        }

        return $row->v;
    }
}
