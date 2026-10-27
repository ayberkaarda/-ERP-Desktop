<?php

declare(strict_types=1);

/*
 * Child process for DeviceReloginRaceTest (not a test file). Runs one real PullService::pull()
 * for a device token and stops between the pull's read snapshot and its session writes: right
 * after the read transaction commits it writes <read marker> and waits for <go marker>.
 * Usage: PullAfterReadWorker.php <user_id> <company_id> <token> <resource> <read marker> <go marker>
 * Prints one JSON line: {"status":"ok","has_more":bool,"session":string|null} or {"status":"error",...}.
 */

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Sync\Services\PullService;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Database\Events\TransactionCommitted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

require __DIR__.'/../../../vendor/autoload.php';

$app = require __DIR__.'/../../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$row = DB::selectOne('select current_database() as name');
TestCase::assertSafeDatabase(is_object($row) && property_exists($row, 'name') && is_string($row->name) ? $row->name : null);

[, $userId, $companyId, $token, $resource, $readMarker, $goMarker] = $argv;
$table = $resource;
$seenRows = false;
$paused = false;

Event::listen(QueryExecuted::class, static function (QueryExecuted $query) use (&$seenRows, $table): void {
    if (str_contains($query->sql, '"'.$table.'"')) {
        $seenRows = true;
    }
});

Event::listen(TransactionCommitted::class, static function () use (&$seenRows, &$paused, $readMarker, $goMarker): void {
    if ($paused || ! $seenRows || DB::transactionLevel() !== 0) {
        return;
    }

    $paused = true;
    file_put_contents($readMarker, 'read');

    for ($i = 0; $i < 400 && ! is_file($goMarker); $i++) {
        usleep(50_000);
    }
});

try {
    $user = User::query()->findOrFail($userId);
    $tokenId = (string) strstr($token, '|', true);
    $out = $app->make(CompanyContext::class)->runAs($companyId, static fn (): array => $app->make(PullService::class)
        ->pull($user, $companyId, [['resource' => $resource, 'cursor' => null, 'limit' => 1]], $tokenId));
    $page = $out['resources'][0];

    echo json_encode(['status' => 'ok', 'paused' => $paused, 'has_more' => $page['has_more'], 'session' => $page['next_cursor']['session']], JSON_THROW_ON_ERROR);
} catch (Throwable $e) {
    echo json_encode(['status' => 'error', 'code' => $e::class, 'message' => $e->getMessage()], JSON_THROW_ON_ERROR);
}
