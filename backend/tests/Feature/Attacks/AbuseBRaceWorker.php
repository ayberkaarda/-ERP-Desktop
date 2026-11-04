<?php

declare(strict_types=1);

/*
 * Child process for AbuseBRaceTest (not a test file). Modes:
 *   refresh <refresh_token> <marker> <hold_ms>  refresh in a transaction, write marker, hold the locks, commit
 *   send <company> <quote_id> <user_id> <marker> <hold_ms>  send a draft quote on the web path, hold, commit
 * Prints one JSON line: {"status":"ok", ...} or {"status":"error","code":...}.
 */

use App\Core\Company\CompanyContext;
use App\Core\Http\ApiException;
use App\Models\User;
use App\Modules\Identity\Services\DeviceTokens;
use App\Modules\Sales\Models\SalesQuote;
use App\Modules\Sales\Services\QuoteService;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

require __DIR__.'/../../../vendor/autoload.php';

$app = require __DIR__.'/../../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$row = DB::selectOne('select current_database() as name');
TestCase::assertSafeDatabase(is_object($row) && property_exists($row, 'name') && is_string($row->name) ? $row->name : null);

$mode = $argv[1] ?? '';

try {
    if ($mode === 'refresh') {
        [, , $refresh, $marker, $hold] = $argv;
        $out = DB::transaction(static function () use ($app, $refresh, $marker, $hold): array {
            $issued = $app->make(DeviceTokens::class)->refresh($refresh, '127.0.0.9');
            file_put_contents($marker, 'locked');
            usleep(((int) $hold) * 1000);

            return $issued;
        });
        echo json_encode(['status' => 'ok', 'token' => $out['token'], 'refresh_token' => $out['refresh_token']], JSON_THROW_ON_ERROR);
    } elseif ($mode === 'send') {
        [, , $company, $quoteId, $userId, $marker, $hold] = $argv;
        $out = DB::transaction(static function () use ($app, $company, $quoteId, $userId, $marker, $hold): array {
            $quote = $app->make(CompanyContext::class)->runAs($company, static function () use ($app, $quoteId, $userId): SalesQuote {
                return $app->make(QuoteService::class)->send(SalesQuote::query()->findOrFail($quoteId), null, User::query()->findOrFail($userId));
            });
            file_put_contents($marker, 'locked');
            usleep(((int) $hold) * 1000);

            return ['status_after' => $quote->currentStatus(), 'version' => $quote->currentVersion()];
        });
        echo json_encode(['status' => 'ok', ...$out], JSON_THROW_ON_ERROR);
    } else {
        echo json_encode(['status' => 'error', 'code' => 'BAD_MODE'], JSON_THROW_ON_ERROR);
    }
} catch (ApiException $e) {
    echo json_encode(['status' => 'error', 'code' => $e->errorCode->value], JSON_THROW_ON_ERROR);
}
