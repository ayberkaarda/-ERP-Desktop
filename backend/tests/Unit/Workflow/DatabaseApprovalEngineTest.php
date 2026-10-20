<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Core\Company\MembershipChecker;
use App\Core\Documents\VersionConflictException;
use App\Core\Http\ApiException;
use App\Modules\Workflow\Contracts\ApprovalEngine;
use App\Modules\Workflow\Contracts\ApproverResolver;
use App\Modules\Workflow\Models\ApprovalDecision;
use App\Modules\Workflow\Models\ApprovalRequest;
use App\Modules\Workflow\Repositories\ApprovalFlowRepository;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Tests\Fixtures\FixtureDocument;
use Tests\Support\Workflow\WorkflowTestUser;
use Tests\TestCase;

uses(TestCase::class, RefreshDatabase::class);

beforeEach(function (): void {
    FixtureDocument::createTable();
    $this->company = (string) Str::uuid7();
    $this->otherCompany = (string) Str::uuid7();
    app(CompanyContext::class)->set($this->company);
    $this->requester = new WorkflowTestUser(['id' => (string) Str::uuid7()]);
    $this->first = new WorkflowTestUser(['id' => (string) Str::uuid7()]);
    $this->second = new WorkflowTestUser(['id' => (string) Str::uuid7()]);
    $this->permissions = ['approvals.view', 'approvals.decide', 'approval_flows.manage'];
    foreach ($this->permissions as $permission) {
        Gate::define($permission, fn () => in_array($permission, $this->permissions, true));
    }
    $this->app->instance(MembershipChecker::class, new class($this->company) implements MembershipChecker
    {
        public function __construct(private readonly string $company) {}

        public function isMember(string $userId, string $companyId): bool
        {
            return $companyId === $this->company;
        }
    });
    $this->app->instance(ApproverResolver::class, new class((string) $this->first->getAuthIdentifier(), (string) $this->second->getAuthIdentifier()) implements ApproverResolver
    {
        public function __construct(private readonly string $first, private readonly string $second) {}

        public function resolve(string $companyId, string $type, string $reference): array
        {
            return $type === 'user' ? [$reference] : [$this->first, $this->second];
        }
    });
    $this->actingAs($this->requester, 'sanctum');
    $this->engine = app(ApprovalEngine::class);
    $this->doc = FixtureDocument::create(['name' => 'Purchase']);
    $this->payload = [
        'name' => 'Purchase approval', 'document_type' => 'purchase_order',
        'steps' => [
            ['position' => 1, 'mode' => 'any_of', 'approver_type' => 'role', 'approver_ref' => 'manager'],
        ],
    ];
    $this->flow = fn (array $overrides = []) => app(ApprovalFlowRepository::class)->create(array_replace($this->payload, $overrides));
    $this->headers = ['X-Company-Id' => $this->company, 'Idempotency-Key' => (string) Str::uuid7()];
});

it('auto approves when no flow is defined', function (): void {
    $r = $this->engine->start($this->doc, 'purchase_order', '12.3400');
    expect($r->status)->toBe('approved')->and($r->flow_id)->toBeNull()
        ->and($r->amount)->toBe('12.3400')->and($r->version)->toBe(2);
});

it('starts only one pending request for a document', function (): void {
    ($this->flow)();
    $a = $this->engine->start($this->doc, 'purchase_order', null);
    $b = $this->engine->start($this->doc, 'purchase_order', null);
    expect($a->id)->toBe($b->id)->and(ApprovalRequest::query()->count())->toBe(1);
});

it('approves any_of with one actor and preserves decimal amounts', function (): void {
    ($this->flow)();
    $r = $this->engine->start($this->doc, 'purchase_order', '9999999999999999.9999');
    $done = $this->engine->decide($r, $this->first, 'approve');
    expect($done->status)->toBe('approved')->and($done->amount)->toBe('9999999999999999.9999');
});

it('requires every role member for all_of and removes decided items from pending', function (): void {
    $payload = $this->payload;
    $payload['steps'][0]['mode'] = 'all_of';
    ($this->flow)($payload);
    $r = $this->engine->start($this->doc, 'purchase_order', null);
    $r = $this->engine->decide($r, $this->first, 'approve');
    expect($r->status)->toBe('pending')->and($r->version)->toBe(2)
        ->and($this->engine->pendingFor($this->first)->count())->toBe(0)
        ->and($this->engine->pendingFor($this->second)->count())->toBe(1);
    $r = $this->engine->decide($r, $this->second, 'approve');
    expect($r->status)->toBe('approved');
});

it('rejects immediately without waiting for all_of', function (): void {
    $payload = $this->payload;
    $payload['steps'][0]['mode'] = 'all_of';
    ($this->flow)($payload);
    $r = $this->engine->start($this->doc, 'purchase_order', null);
    $r = $this->engine->decide($r, $this->first, 'reject', 'Budget');
    expect($r->status)->toBe('rejected')->and($r->decisions()->count())->toBe(1);
});

it('skips thresholds outside range and advances in position order', function (): void {
    ($this->flow)(['steps' => [
        ['position' => 3, 'mode' => 'any_of', 'approver_type' => 'role', 'approver_ref' => 'manager'],
        ['position' => 1, 'mode' => 'any_of', 'approver_type' => 'role', 'approver_ref' => 'manager', 'min_amount' => '100.0001'],
        ['position' => 2, 'mode' => 'any_of', 'approver_type' => 'user', 'approver_ref' => (string) $this->first->getAuthIdentifier(), 'max_amount' => '100.0000'],
    ]]);
    $r = $this->engine->start($this->doc, 'purchase_order', '100.0000');
    expect($r->current_step)->toBe(2);
    $r = $this->engine->decide($r, $this->first, 'approve');
    expect($r->current_step)->toBe(3)->and($r->status)->toBe('pending');
    $r = $this->engine->decide($r, $this->second, 'approve');
    expect($r->status)->toBe('approved');
});

it('auto approves when every step is skipped', function (): void {
    $payload = $this->payload;
    $payload['steps'][0]['min_amount'] = '100';
    ($this->flow)($payload);
    expect($this->engine->start($this->doc, 'purchase_order', '99.9999')->status)->toBe('approved');
});

it('blocks self approval by default', function (): void {
    ($this->flow)();
    $r = $this->engine->start($this->doc, 'purchase_order', null);
    $this->engine->decide($r, $this->requester, 'approve');
})->throws(ApiException::class);

it('allows self approval only when the flow opts in', function (): void {
    ($this->flow)(['allow_self_approval' => true, 'steps' => [
        ['position' => 1, 'mode' => 'any_of', 'approver_type' => 'user', 'approver_ref' => (string) $this->requester->getAuthIdentifier()],
    ]]);
    $r = $this->engine->start($this->doc, 'purchase_order', null);
    expect($this->engine->decide($r, $this->requester, 'approve')->status)->toBe('approved');
});

it('fails closed for steps without eligible approvers', function (): void {
    ($this->flow)(['steps' => [
        ['position' => 1, 'mode' => 'any_of', 'approver_type' => 'user', 'approver_ref' => (string) $this->requester->getAuthIdentifier()],
    ]]);
    try {
        $this->engine->start($this->doc, 'purchase_order', null);
    } catch (ApiException $e) {
        expect($e->status())->toBe(422);
    }
    expect(ApprovalRequest::query()->count())->toBe(0);
});

it('replays decisions idempotently and refuses changed decisions', function (): void {
    ($this->flow)();
    $r = $this->engine->start($this->doc, 'purchase_order', null);
    $this->engine->decide($r, $this->first, 'approve', 'OK');
    $replay = $this->engine->decide($r, $this->first, 'approve', 'OK');
    expect($replay->status)->toBe('approved')->and(ApprovalDecision::query()->count())->toBe(1);
    $this->engine->decide($r, $this->first, 'reject', 'Changed');
})->throws(ApiException::class);

it('rejects stale versions during concurrent all_of decisions', function (): void {
    $payload = $this->payload;
    $payload['steps'][0]['mode'] = 'all_of';
    ($this->flow)($payload);
    $r = $this->engine->start($this->doc, 'purchase_order', null);
    $stale = ApprovalRequest::query()->findOrFail($r->id);
    $this->engine->decide($r, $this->first, 'approve');
    $this->engine->decide($stale, $this->second, 'approve');
})->throws(VersionConflictException::class);

it('keeps approval snapshots stable after flow changes', function (): void {
    $flow = ($this->flow)();
    $r = $this->engine->start($this->doc, 'purchase_order', null);
    app(ApprovalFlowRepository::class)->update($flow, ['version' => 1, 'steps' => [
        ['position' => 1, 'mode' => 'any_of', 'approver_type' => 'user', 'approver_ref' => (string) $this->requester->getAuthIdentifier()],
    ]]);
    expect($this->engine->decide($r, $this->first, 'approve')->status)->toBe('approved');
});

it('lets the requester cancel and forbids later decisions', function (): void {
    ($this->flow)();
    $r = $this->engine->start($this->doc, 'purchase_order', null);
    $r = $this->engine->cancel($r, $this->requester);
    expect($r->status)->toBe('cancelled');
    $this->engine->decide($r, $this->first, 'approve');
})->throws(ApiException::class);

it('prevents cross company engine access', function (): void {
    ($this->flow)();
    $r = $this->engine->start($this->doc, 'purchase_order', null);
    app(CompanyContext::class)->set($this->otherCompany);
    $this->engine->decide($r, $this->first, 'approve');
})->throws(ApiException::class);

it('refuses unsupported amount precision and numeric overflow', function (string $amount): void {
    ($this->flow)();
    $this->engine->start($this->doc, 'purchase_order', $amount);
})->with(['1.00001', '10000000000000000', 'invalid'])->throws(ApiException::class);

it('refuses to cancel another users request', function (): void {
    ($this->flow)();
    $r = $this->engine->start($this->doc, 'purchase_order', null);
    $this->engine->cancel($r, $this->first);
})->throws(ApiException::class);

it('blocks starting approval against a foreign document', function (): void {
    app(CompanyContext::class)->set($this->otherCompany);
    $this->engine->start($this->doc, 'purchase_order', null);
})->throws(ApiException::class);

it('refuses to start without an amount when the flow has thresholds', function (): void {
    ($this->flow)(['steps' => [
        ['position' => 1, 'mode' => 'any_of', 'approver_type' => 'role', 'approver_ref' => 'manager', 'min_amount' => '1000'],
    ]]);
    try {
        $this->engine->start($this->doc, 'purchase_order', null);
        $this->fail('start() must refuse a missing amount');
    } catch (ApiException $e) {
        expect($e->status())->toBe(422)->and($e->fields)->toHaveKey('amount');
    }
    expect(ApprovalRequest::query()->count())->toBe(0);
});

it('recalculates steps when the document amount or revision changes', function (): void {
    ($this->flow)(['steps' => [
        ['position' => 1, 'mode' => 'any_of', 'approver_type' => 'role', 'approver_ref' => 'manager'],
        ['position' => 2, 'mode' => 'any_of', 'approver_type' => 'user', 'approver_ref' => (string) $this->second->getAuthIdentifier(), 'min_amount' => '1000'],
    ]]);
    $old = $this->engine->start($this->doc, 'purchase_order', '100', 'r1');
    expect($old->steps)->toHaveCount(1)
        ->and($this->engine->start($this->doc, 'purchase_order', '100', 'r1')->id)->toBe($old->id);

    $raised = $this->engine->start($this->doc, 'purchase_order', '5000', 'r1');
    expect($raised->id)->not->toBe($old->id)->and($raised->steps)->toHaveCount(2)
        ->and($raised->amount)->toBe('5000.0000')
        ->and(ApprovalRequest::query()->findOrFail($old->id)->status)->toBe('cancelled');

    $revised = $this->engine->start($this->doc, 'purchase_order', '5000', 'r2');
    expect($revised->id)->not->toBe($raised->id)->and($revised->revision)->toBe('r2')
        ->and(ApprovalRequest::query()->where('status', 'pending')->count())->toBe(1);
});

it('keeps the relational approver list in step with the active step', function (): void {
    $approvers = fn (): array => DB::table('approval_request_approvers')->orderBy('step_position')->orderBy('approver_ref')
        ->get()->map(fn ($row): string => $row->step_position.':'.$row->approver_ref)->all();
    ($this->flow)(['steps' => [
        ['position' => 1, 'mode' => 'all_of', 'approver_type' => 'role', 'approver_ref' => 'manager'],
        ['position' => 2, 'mode' => 'any_of', 'approver_type' => 'user', 'approver_ref' => (string) $this->second->getAuthIdentifier()],
    ]]);
    $first = (string) $this->first->getAuthIdentifier();
    $second = (string) $this->second->getAuthIdentifier();
    $r = $this->engine->start($this->doc, 'purchase_order', null);
    $both = ["1:$first", "1:$second"];
    sort($both);
    expect($approvers())->toBe($both);
    $r = $this->engine->decide($r, $this->first, 'approve');
    expect($approvers())->toBe(["1:$second"]);
    $r = $this->engine->decide($r, $this->second, 'approve');
    expect($approvers())->toBe(["2:$second"])
        ->and($this->engine->pendingFor($this->second)->count())->toBe(1)
        ->and($this->engine->pendingFor($this->first)->count())->toBe(0);
    $this->engine->cancel($r, $this->requester);
    expect($approvers())->toBe([])->and($this->engine->pendingFor($this->second)->count())->toBe(0);
});

it('does not leak pending items of another company', function (): void {
    ($this->flow)();
    $this->engine->start($this->doc, 'purchase_order', null);
    app(CompanyContext::class)->set($this->otherCompany);
    expect($this->engine->pendingFor($this->first)->count())->toBe(0);
});
