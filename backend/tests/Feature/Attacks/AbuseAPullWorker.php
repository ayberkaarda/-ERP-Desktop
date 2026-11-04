<?php

declare(strict_types=1);

/*
 * Child process of AbuseAThrottleTest: one real POST /api/v1/sync/pull through the HTTP kernel,
 * with the database cache store (shared by every process, so pull slots are real cross-process
 * locks). The pull sleeps $holdMs on its first visibility query, i.e. while it holds its slots,
 * so parallel workers overlap. All workers start at $startAt (unix time, float).
 * Usage: <token> <company> <startAt> <holdMs> <perDevice> <perUser>. Prints {"status","code"}.
 */

use Illuminate\Contracts\Console\Kernel as ConsoleKernel;
use Illuminate\Contracts\Http\Kernel as HttpKernel;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Sync\Support\SyncKit;
use Tests\TestCase;

require __DIR__.'/../../../vendor/autoload.php';

$app = require __DIR__.'/../../../bootstrap/app.php';
$app->make(ConsoleKernel::class)->bootstrap();

$row = DB::selectOne('select current_database() as name');
TestCase::assertSafeDatabase(is_object($row) && property_exists($row, 'name') && is_string($row->name) ? $row->name : null);

[, $token, $company, $startAt, $holdMs, $perDevice, $perUser] = $argv;

SyncKit::boot();
config([
    'cache.default' => 'database',
    'sync.throttle.device_per_minute' => 1000,
    'sync.throttle.user_per_minute' => 1000,
    'sync.throttle.concurrent_pulls_per_device' => (int) $perDevice,
    'sync.throttle.concurrent_pulls_per_user' => (int) $perUser,
]);

$held = false;
DB::listen(static function ($query) use (&$held, $holdMs): void {
    if (! $held && str_contains($query->sql, 'sync_visibility_generations')) {
        $held = true;
        usleep((int) $holdMs * 1000);
    }
});

$wait = (float) $startAt - microtime(true);

if ($wait > 0) {
    usleep((int) ($wait * 1_000_000));
}

$body = json_encode(['schema_version' => 1, 'resources' => [['resource' => 'fixture-notes', 'cursor' => null]]], JSON_THROW_ON_ERROR);
$request = Request::create('/api/v1/sync/pull', 'POST', [], [], [], [
    'HTTP_ACCEPT' => 'application/json',
    'CONTENT_TYPE' => 'application/json',
    'HTTP_AUTHORIZATION' => 'Bearer '.$token,
    'HTTP_X_COMPANY_ID' => $company,
    'REMOTE_ADDR' => '127.0.0.1',
], $body);

$kernel = $app->make(HttpKernel::class);
$response = $kernel->handle($request);
$decoded = json_decode((string) $response->getContent(), true);
$code = is_array($decoded) ? ($decoded['errors']['code'] ?? null) : null;
$kernel->terminate($request, $response);

echo json_encode(['status' => $response->getStatusCode(), 'code' => $code], JSON_THROW_ON_ERROR);
