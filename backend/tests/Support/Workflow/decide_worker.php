<?php

declare(strict_types=1);

/*
 * Test-only child process: decides an approval request on its own database connection
 * and prints {"outcome": ..., "events": ...} as JSON. Usage: <company> <request> <actor> <decision>.
 */

use App\Core\Company\CompanyContext;
use App\Core\Http\ApiException;
use App\Models\User;
use App\Modules\Workflow\Contracts\ApprovalEngine;
use App\Modules\Workflow\Events\ApprovalCompleted;
use App\Modules\Workflow\Models\ApprovalRequest;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

require __DIR__.'/../../../vendor/autoload.php';

$app = require __DIR__.'/../../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$row = DB::selectOne('select current_database() as name');
TestCase::assertSafeDatabase(is_object($row) && property_exists($row, 'name') && is_string($row->name) ? $row->name : null);

[, $company, $requestId, $actorId, $decision] = $argv;
$app->make(CompanyContext::class)->set($company);

$events = 0;
Event::listen(ApprovalCompleted::class, static function () use (&$events): void {
    $events++;
});

try {
    $request = ApprovalRequest::query()->findOrFail($requestId);
    $app->make(ApprovalEngine::class)->decide($request, User::query()->findOrFail($actorId), $decision);
    $outcome = 'ok';
} catch (ApiException $e) {
    $outcome = $e->errorCode->value;
}

echo json_encode(['outcome' => $outcome, 'events' => $events], JSON_THROW_ON_ERROR);
