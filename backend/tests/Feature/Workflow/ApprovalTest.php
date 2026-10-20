<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Core\Company\MembershipChecker;
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

uses(RefreshDatabase::class);

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

it('provides flow CRUD with resources and version checks', function (): void {
    $created = $this->postJson('/api/v1/approval-flows', $this->payload, $this->headers)
        ->assertCreated()->assertJsonPath('data.steps.0.mode', 'any_of');
    $id = $created->json('data.id');
    $this->getJson('/api/v1/approval-flows', $this->headers)->assertOk()->assertJsonPath('meta.pagination.total', 1);
    $this->getJson("/api/v1/approval-flows/$id", $this->headers)->assertOk()->assertJsonPath('data.name', 'Purchase approval');
    $this->patchJson("/api/v1/approval-flows/$id", ['name' => 'Updated', 'version' => 1], $this->headers)
        ->assertOk()->assertJsonPath('data.version', 2);
    $this->patchJson("/api/v1/approval-flows/$id", ['name' => 'Stale', 'version' => 1], $this->headers)->assertStatus(409);
    $this->deleteJson("/api/v1/approval-flows/$id", ['version' => 2], $this->headers)->assertNoContent();
    $this->getJson("/api/v1/approval-flows/$id", $this->headers)->assertNotFound();
});

it('lists only pending items assigned to the current user and replays HTTP commands', function (): void {
    ($this->flow)();
    $r = $this->engine->start($this->doc, 'purchase_order', '100');
    $this->actingAs($this->first, 'sanctum');
    $this->getJson('/api/v1/approvals/pending', $this->headers)->assertOk()->assertJsonPath('meta.pagination.total', 1);
    $this->getJson("/api/v1/approvals/$r->id", $this->headers)->assertOk()->assertJsonPath('data.amount', '100.0000');
    $path = "/api/v1/approvals/$r->id/decisions";
    $this->postJson($path, ['decision' => 'approve', 'version' => 1, 'step' => 1], $this->headers)->assertOk()->assertJsonPath('data.status', 'approved');
    $this->postJson($path, ['decision' => 'approve', 'version' => 1, 'step' => 1], $this->headers)->assertOk()->assertHeader('Idempotent-Replayed', 'true');
    $this->postJson($path, ['decision' => 'reject'], $this->headers)->assertStatus(422);
    expect(ApprovalDecision::query()->count())->toBe(1);
});

it('requires a decision idempotency key', function (): void {
    ($this->flow)();
    $r = $this->engine->start($this->doc, 'purchase_order', null);
    $this->actingAs($this->first, 'sanctum');
    $this->postJson("/api/v1/approvals/$r->id/decisions", ['decision' => 'approve', 'version' => 1, 'step' => 1], ['X-Company-Id' => $this->company])
        ->assertStatus(400)->assertJsonPath('errors.code', 'IDEMPOTENCY_KEY_REQUIRED');
});

it('denies endpoints without their permissions', function (): void {
    $flow = ($this->flow)();
    $r = $this->engine->start($this->doc, 'purchase_order', null);
    $this->permissions = [];
    $this->actingAs($this->first, 'sanctum');
    $this->getJson('/api/v1/approvals/pending', $this->headers)->assertForbidden();
    $this->getJson("/api/v1/approvals/$r->id", $this->headers)->assertForbidden();
    $this->postJson("/api/v1/approvals/$r->id/decisions", ['decision' => 'approve', 'version' => 1, 'step' => 1], $this->headers)->assertForbidden();
    $this->getJson('/api/v1/approval-flows', $this->headers)->assertForbidden();
    $this->getJson("/api/v1/approval-flows/$flow->id", $this->headers)->assertForbidden();
    $headers = array_replace($this->headers, ['Idempotency-Key' => (string) Str::uuid7()]);
    $this->postJson('/api/v1/approval-flows', $this->payload, $headers)->assertForbidden();
    $this->patchJson("/api/v1/approval-flows/$flow->id", ['name' => 'No', 'version' => 1], $headers)->assertForbidden();
    $this->deleteJson("/api/v1/approval-flows/$flow->id", ['version' => 1], $headers)->assertForbidden();
});

it('blocks a requester and an unrelated actor from deciding via HTTP', function (): void {
    ($this->flow)();
    $r = $this->engine->start($this->doc, 'purchase_order', null);
    $this->postJson("/api/v1/approvals/$r->id/decisions", ['decision' => 'approve', 'version' => 1, 'step' => 1], $this->headers)->assertForbidden();
    $this->actingAs(new WorkflowTestUser(['id' => (string) Str::uuid7()]), 'sanctum');
    $this->postJson("/api/v1/approvals/$r->id/decisions", ['decision' => 'approve', 'version' => 1, 'step' => 1], $this->headers)->assertForbidden();
    expect(ApprovalDecision::query()->count())->toBe(0);
});

it('hides foreign company records for every resource action', function (): void {
    [$flow, $r] = app(CompanyContext::class)->runAs($this->otherCompany, function (): array {
        $flow = ($this->flow)();
        $doc = FixtureDocument::create(['name' => 'Foreign']);

        return [$flow, $this->engine->start($doc, 'purchase_order', null)];
    });
    $this->actingAs($this->first, 'sanctum');
    $this->getJson('/api/v1/approval-flows', $this->headers)->assertOk()->assertJsonPath('meta.pagination.total', 0);
    $this->getJson('/api/v1/approvals/pending', $this->headers)->assertOk()->assertJsonPath('meta.pagination.total', 0);
    $this->getJson("/api/v1/approval-flows/$flow->id", $this->headers)->assertNotFound();
    $this->patchJson("/api/v1/approval-flows/$flow->id", ['name' => 'No', 'version' => 1], $this->headers)->assertNotFound();
    $this->deleteJson("/api/v1/approval-flows/$flow->id", ['version' => 1], $this->headers)->assertNotFound();
    $this->getJson("/api/v1/approvals/$r->id", $this->headers)->assertNotFound();
    $this->postJson("/api/v1/approvals/$r->id/decisions", ['decision' => 'approve', 'version' => 1, 'step' => 1], $this->headers)->assertNotFound();
});

it('validates thresholds, user UUIDs, positions and string money', function (array $step): void {
    $payload = array_replace($this->payload, ['steps' => [$step]]);
    $this->postJson('/api/v1/approval-flows', $payload, $this->headers)->assertUnprocessable();
})->with([
    [['position' => 1, 'mode' => 'any_of', 'approver_type' => 'role', 'approver_ref' => 'manager', 'min_amount' => '2', 'max_amount' => '1']],
    [['position' => 1, 'mode' => 'any_of', 'approver_type' => 'user', 'approver_ref' => '123']],
    [['position' => 0, 'mode' => 'any_of', 'approver_type' => 'role', 'approver_ref' => 'manager']],
    [['position' => 1, 'mode' => 'invalid', 'approver_type' => 'role', 'approver_ref' => 'manager']],
    [['position' => 1, 'mode' => 'any_of', 'approver_type' => 'role', 'approver_ref' => 'manager', 'min_amount' => 1.5]],
]);

it('requires company membership and a company header', function (): void {
    $this->getJson('/api/v1/approval-flows')->assertStatus(400);
    $this->getJson('/api/v1/approval-flows', ['X-Company-Id' => $this->otherCompany])->assertForbidden();
});

it('rejects duplicate active flows while allowing inactive definitions', function (): void {
    ($this->flow)();
    $this->postJson('/api/v1/approval-flows', $this->payload, $this->headers)
        ->assertUnprocessable()->assertJsonPath('errors.code', 'VALIDATION_ERROR');
    $payload = array_replace($this->payload, ['is_active' => false]);
    $headers = array_replace($this->headers, ['Idempotency-Key' => (string) Str::uuid7()]);
    $this->postJson('/api/v1/approval-flows', $payload, $headers)->assertCreated();
});

it('validates decision input and enforces the supplied version', function (): void {
    ($this->flow)();
    $r = $this->engine->start($this->doc, 'purchase_order', null);
    $this->actingAs($this->first, 'sanctum');
    $this->postJson("/api/v1/approvals/$r->id/decisions", ['decision' => 'unknown'], $this->headers)->assertUnprocessable();
    $headers = array_replace($this->headers, ['Idempotency-Key' => (string) Str::uuid7()]);
    $this->postJson("/api/v1/approvals/$r->id/decisions", ['decision' => 'approve', 'version' => 99, 'step' => 1], $headers)
        ->assertStatus(409)->assertJsonPath('errors.code', 'VERSION_CONFLICT');
    expect(ApprovalDecision::query()->count())->toBe(0);
});

it('requires the version and the step the client saw', function (): void {
    ($this->flow)();
    $r = $this->engine->start($this->doc, 'purchase_order', null);
    $this->actingAs($this->first, 'sanctum');
    $path = "/api/v1/approvals/$r->id/decisions";
    $this->postJson($path, ['decision' => 'approve', 'step' => 1], $this->headers)->assertUnprocessable();
    $headers = array_replace($this->headers, ['Idempotency-Key' => (string) Str::uuid7()]);
    $this->postJson($path, ['decision' => 'approve', 'version' => 1], $headers)->assertUnprocessable();
    expect(ApprovalDecision::query()->count())->toBe(0);
});

it('rejects a decision made from a stale screen of an earlier step', function (): void {
    ($this->flow)(['steps' => [
        ['position' => 1, 'mode' => 'any_of', 'approver_type' => 'role', 'approver_ref' => 'manager'],
        ['position' => 2, 'mode' => 'any_of', 'approver_type' => 'role', 'approver_ref' => 'manager'],
    ]]);
    $r = $this->engine->start($this->doc, 'purchase_order', null);
    $this->engine->decide($r, $this->first, 'approve');
    $this->actingAs($this->second, 'sanctum');
    $path = "/api/v1/approvals/$r->id/decisions";
    // The screen was rendered while step 1 was active (version 1).
    $this->postJson($path, ['decision' => 'approve', 'version' => 1, 'step' => 1], $this->headers)
        ->assertStatus(409)->assertJsonPath('errors.code', 'VERSION_CONFLICT');
    expect(ApprovalDecision::query()->count())->toBe(1);
    $headers = array_replace($this->headers, ['Idempotency-Key' => (string) Str::uuid7()]);
    $fresh = ApprovalRequest::query()->findOrFail($r->id);
    $this->postJson($path, ['decision' => 'approve', 'version' => $fresh->version, 'step' => 2], $headers)
        ->assertOk()->assertJsonPath('data.status', 'approved');
});

it('paginates the pending list with a correct total', function (): void {
    ($this->flow)();
    foreach (range(1, 3) as $i) {
        $this->engine->start(FixtureDocument::create(['name' => "Doc $i"]), 'purchase_order', null);
    }
    $this->actingAs($this->first, 'sanctum');
    $this->getJson('/api/v1/approvals/pending?per_page=2', $this->headers)->assertOk()
        ->assertJsonPath('meta.pagination.total', 3)->assertJsonCount(2, 'data');
});

it('rejects a decision whose step differs from the active step even with the current version', function (): void {
    ($this->flow)();
    $r = $this->engine->start($this->doc, 'purchase_order', null);
    $this->actingAs($this->first, 'sanctum');
    $this->postJson("/api/v1/approvals/$r->id/decisions", ['decision' => 'approve', 'version' => $r->version, 'step' => 2], $this->headers)
        ->assertStatus(409)->assertJsonPath('errors.code', 'VERSION_CONFLICT');
    expect(ApprovalDecision::query()->count())->toBe(0);
});
