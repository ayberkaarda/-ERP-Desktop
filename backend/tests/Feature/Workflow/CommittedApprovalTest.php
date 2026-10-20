<?php

declare(strict_types=1);

/*
 * These tests commit real data (no wrapping test transaction) because they need a second
 * database connection / process and real after-commit event dispatching. They clean up after themselves.
 */

use App\Core\Company\CompanyContext;
use App\Core\Http\ApiException;
use App\Models\User;
use App\Modules\Workflow\Contracts\ApprovalEngine;
use App\Modules\Workflow\Contracts\ApproverResolver;
use App\Modules\Workflow\Events\ApprovalCancelled;
use App\Modules\Workflow\Events\ApprovalCompleted;
use App\Modules\Workflow\Models\ApprovalDecision;
use App\Modules\Workflow\Models\ApprovalRequest;
use App\Modules\Workflow\Repositories\ApprovalFlowRepository;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Schema;
use Tests\Fixtures\FixtureDocument;
use Tests\Support\Companies;

beforeEach(function (): void {
    if (! Schema::hasTable('approval_requests')) {
        Artisan::call('migrate', ['--force' => true]);
    }
    Schema::dropIfExists('fixture_documents');
    FixtureDocument::createTable();
    // Committed rows: a real company and users, removed again in afterEach.
    $this->company = Companies::make();
    $this->requester = User::factory()->create();
    $this->first = User::factory()->create();
    $this->second = User::factory()->create();
    app(CompanyContext::class)->set($this->company);
    $this->app->instance(ApproverResolver::class, new class((string) $this->first->getAuthIdentifier(), (string) $this->second->getAuthIdentifier()) implements ApproverResolver
    {
        public function __construct(private readonly string $first, private readonly string $second) {}

        public function resolve(string $companyId, string $type, string $reference): array
        {
            return [$this->first, $this->second];
        }
    });
    $this->actingAs($this->requester, 'sanctum');
    $this->engine = app(ApprovalEngine::class);
    $this->doc = FixtureDocument::create(['name' => 'Purchase']);
});

afterEach(function (): void {
    if (isset($this->locker) && $this->locker->transactionLevel() > 0) {
        $this->locker->rollBack();
    }
    foreach (['approval_request_approvers', 'approval_decisions', 'approval_requests', 'approval_flow_steps', 'approval_flows'] as $table) {
        DB::table($table)->where('company_id', $this->company)->delete();
    }
    $users = [$this->requester->id, $this->first->id, $this->second->id];
    DB::table('activity_log')->whereIn('subject_id', $users)->delete();
    DB::table('users')->whereIn('id', $users)->delete();
    Companies::remove($this->company);
    Schema::dropIfExists('fixture_documents');
});

it('serializes two deciders on the request row lock and completes exactly once', function (): void {
    app(ApprovalFlowRepository::class)->create([
        'name' => 'Purchase', 'document_type' => 'purchase_order',
        'steps' => [['position' => 1, 'mode' => 'any_of', 'approver_type' => 'role', 'approver_ref' => 'manager']],
    ]);
    $request = $this->engine->start($this->doc, 'purchase_order', null);

    config(['database.connections.lock_b' => config('database.connections.pgsql')]);
    $locker = DB::connection('lock_b');
    $this->locker = $locker;
    $locker->beginTransaction();
    $locker->table('approval_requests')->where('id', $request->id)->lockForUpdate()->first();

    $config = config('database.connections.pgsql');
    $env = array_merge(getenv(), [
        'APP_ENV' => 'testing', 'DB_CONNECTION' => 'pgsql', 'DB_URL' => '',
        'DB_HOST' => (string) $config['host'], 'DB_PORT' => (string) $config['port'],
        'DB_DATABASE' => (string) $config['database'], 'DB_USERNAME' => (string) $config['username'],
        'DB_PASSWORD' => (string) $config['password'],
    ]);
    $out = tempnam(sys_get_temp_dir(), 'wf');
    $process = proc_open(
        [PHP_BINARY, base_path('tests/Support/Workflow/decide_worker.php'), $this->company, $request->id, (string) $this->second->getAuthIdentifier(), 'approve'],
        [1 => ['file', $out, 'w'], 2 => ['file', $out.'.err', 'w']], $pipes, base_path(), $env,
    );
    expect(is_resource($process))->toBeTrue();

    // The child must be parked behind our row lock before we release it.
    $blocked = false;
    for ($i = 0; $i < 100 && ! $blocked; $i++) {
        $row = DB::selectOne("select count(*) as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()");
        // Polled outside the locker transaction: pg_stat_activity is snapshotted per transaction.
        $blocked = is_object($row) && (int) $row->n > 0;
        $blocked || usleep(200_000);
    }
    if (! $blocked) {
        $locker->rollBack();
    }
    expect($blocked)->toBeTrue('the second connection was not blocked by the row lock: '.(string) file_get_contents($out.'.err'));
    expect($locker->table('approval_decisions')->where('request_id', $request->id)->count())->toBe(0);

    $events = 0;
    Event::listen(ApprovalCompleted::class, function () use (&$events): void {
        $events++;
    });
    $locker->commit();

    $parentOutcome = 'ok';
    try {
        $this->engine->decide($request, $this->first, 'approve');
    } catch (ApiException $e) {
        $parentOutcome = $e->errorCode->value;
    }

    for ($i = 0; $i < 300 && (proc_get_status($process)['running'] ?? false); $i++) {
        usleep(100_000);
    }
    proc_close($process);
    $child = json_decode((string) file_get_contents($out), true, 512, JSON_THROW_ON_ERROR);
    @unlink($out);
    @unlink($out.'.err');

    $outcomes = [$parentOutcome, $child['outcome']];
    $failed = array_values(array_filter($outcomes, fn (string $outcome): bool => $outcome !== 'ok'));
    expect($failed)->toHaveCount(1)->and($failed[0])->toBeIn(['VERSION_CONFLICT', 'INVALID_STATE_TRANSITION'])
        ->and(ApprovalRequest::query()->findOrFail($request->id)->status)->toBe('approved')
        ->and(ApprovalDecision::query()->where('request_id', $request->id)->count())->toBe(1)
        ->and($events + $child['events'])->toBe(1);
});

it('fires approval events only after commit and never on rollback', function (): void {
    $fired = 0;
    Event::listen(ApprovalCompleted::class, function () use (&$fired): void {
        $fired++;
    });
    $other = FixtureDocument::create(['name' => 'Second']);

    DB::transaction(function () use (&$fired): void {
        // No flow for this type: the request is auto-approved inside the transaction.
        $this->engine->start($this->doc, 'unflowed', null);
        expect($fired)->toBe(0);
    });
    expect($fired)->toBe(1);

    try {
        DB::transaction(function () use ($other): void {
            $this->engine->start($other, 'unflowed', null);
            throw new RuntimeException('rollback');
        });
    } catch (RuntimeException) {
    }
    expect($fired)->toBe(1)
        ->and(ApprovalRequest::query()->where('document_id', $other->id)->count())->toBe(0);
});

it('cancels the stale request and announces it once when the amount is raised', function (): void {
    app(ApprovalFlowRepository::class)->create([
        'name' => 'Purchase', 'document_type' => 'purchase_order',
        'steps' => [['position' => 1, 'mode' => 'any_of', 'approver_type' => 'role', 'approver_ref' => 'manager']],
    ]);
    $cancelled = [];
    Event::listen(ApprovalCancelled::class, function (ApprovalCancelled $event) use (&$cancelled): void {
        $cancelled[] = $event->requestId;
    });
    $old = $this->engine->start($this->doc, 'purchase_order', '100');
    $this->engine->start($this->doc, 'purchase_order', '100');
    expect($cancelled)->toBe([]);
    $new = $this->engine->start($this->doc, 'purchase_order', '900');
    expect($cancelled)->toBe([$old->id])->and($new->id)->not->toBe($old->id);
});
