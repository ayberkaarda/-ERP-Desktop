<?php

declare(strict_types=1);

/*
 * Child process for SyncDeviceLockOrderTest (not a test file). Runs FullDownloads::start() once,
 * the session write of a pull that began a full download, for the given device and token.
 * Usage: StartSessionWorker.php <device_id> <user_id> <company_id> <resource> <token_id>
 * Prints one JSON line: {"status":"ok","sessions":int} or {"status":"error","sqlstate":...}.
 */

use App\Core\Sync\Cursor;
use App\Core\Sync\Xid8;
use App\Modules\Sync\Services\FullDownloads;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

require __DIR__.'/../../../vendor/autoload.php';

$app = require __DIR__.'/../../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$row = DB::selectOne('select current_database() as name');
TestCase::assertSafeDatabase(is_object($row) && property_exists($row, 'name') && is_string($row->name) ? $row->name : null);

[, $device, $userId, $companyId, $resource, $tokenId] = $argv;
DB::statement("SET lock_timeout = '15s'");

try {
    $app->make(FullDownloads::class)->start(
        $device, $userId, $companyId, $resource, null, (string) Str::uuid7(),
        Cursor::fromWire(['txid' => '1', 'after_id' => null, 'gen' => 0]), Xid8::of('1'), $tokenId,
    );

    echo json_encode(['status' => 'ok', 'sessions' => DB::table('sync_full_downloads')->where('device_id', $device)->count()], JSON_THROW_ON_ERROR);
} catch (QueryException $e) {
    echo json_encode(['status' => 'error', 'sqlstate' => (string) ($e->errorInfo[0] ?? ''), 'message' => $e->getMessage()], JSON_THROW_ON_ERROR);
}
