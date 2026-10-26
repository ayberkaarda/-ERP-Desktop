<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Identity\Models\Activity;
use App\Modules\Identity\Models\Role;
use App\Modules\Identity\Services\DefaultRoles;
use App\Modules\Identity\Services\PermissionCatalog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\Identity;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Identity::boot();
    $this->a = Identity::company();
    $this->b = Identity::company();
    $this->admin = Identity::member($this->a, ['Admin']);
    $this->viewer = Identity::member($this->a, ['Viewer']);
});

function roleOf(string $companyId, string $name): Role
{
    return app(CompanyContext::class)->runAs($companyId, fn (): Role => Role::query()->where('name', $name)->firstOrFail());
}

function asUser(User $user): mixed
{
    Identity::fresh();

    return test()->actingAs($user);
}

it('creates the default roles for every new company; Admin holds the catalog', function (): void {
    $names = app(CompanyContext::class)->runAs($this->a->id, fn () => Role::query()->orderBy('name')->pluck('name')->all());
    $expected = DefaultRoles::names();
    sort($expected);

    $adminPermissions = roleOf($this->a->id, 'Admin')->permissions()->pluck('name')->all();

    expect($names)->toBe($expected)
        ->and($adminPermissions)->toContain('users.view', 'approvals.decide', 'approval_flows.manage', 'settings.update', 'files.delete', 'notifications.view')
        ->and($adminPermissions)->not->toContain('companies.delete')
        ->and(roleOf($this->a->id, 'Viewer')->permissions()->pluck('name')->all())->not->toContain('approvals.view');
});

it('lists roles of the active company only', function (): void {
    $ids = asUser($this->admin)->getJson('/api/v1/roles?per_page=100', Identity::headers($this->a))
        ->assertOk()->json('data.*.id');

    expect($ids)->toContain(roleOf($this->a->id, 'Sales')->id)->not->toContain(roleOf($this->b->id, 'Sales')->id);

    $other = roleOf($this->b->id, 'Sales');
    asUser($this->admin)->getJson("/api/v1/roles/{$other->id}", Identity::headers($this->a))->assertNotFound();
    asUser($this->admin)->patchJson("/api/v1/roles/{$other->id}", ['name' => 'Hacked'], Identity::headers($this->a))->assertNotFound();
    asUser($this->admin)->deleteJson("/api/v1/roles/{$other->id}", [], Identity::headers($this->a))->assertNotFound();
});

it('creates, updates and deletes a custom role and audits permission changes', function (): void {
    $id = asUser($this->admin)->postJson('/api/v1/roles', ['name' => 'Auditor', 'permissions' => ['audit.view']], Identity::headers($this->a, idempotent: true))
        ->assertCreated()->assertJsonPath('data.permissions', ['audit.view'])->json('data.id');

    asUser($this->admin)->patchJson("/api/v1/roles/{$id}", ['permissions' => ['audit.view', 'audit.export']], Identity::headers($this->a))
        ->assertOk()->assertJsonPath('data.permissions', ['audit.export', 'audit.view']);

    $log = app(CompanyContext::class)->runAs($this->a->id, fn () => Activity::query()->where('subject_id', $id)->where('event', 'permissions_synced')->orderByDesc('id')->firstOrFail());
    expect($log->attribute_changes?->get('old'))->toBe(['permissions' => ['audit.view']])
        ->and($log->attribute_changes?->get('attributes'))->toBe(['permissions' => ['audit.export', 'audit.view']]);

    asUser($this->admin)->postJson('/api/v1/roles', ['name' => 'Auditor'], Identity::headers($this->a, idempotent: true))->assertStatus(422);
    asUser($this->admin)->postJson('/api/v1/roles', ['name' => 'X', 'permissions' => ['made.up']], Identity::headers($this->a, idempotent: true))->assertStatus(422);

    asUser($this->admin)->deleteJson("/api/v1/roles/{$id}", [], Identity::headers($this->a))->assertNoContent();
});

it('allows the same role name in two companies', function (): void {
    asUser($this->admin)->postJson('/api/v1/roles', ['name' => 'Cashier'], Identity::headers($this->a, idempotent: true))->assertCreated();
    $adminB = Identity::member($this->b, ['Admin']);
    asUser($adminB)->postJson('/api/v1/roles', ['name' => 'Cashier'], Identity::headers($this->b, idempotent: true))->assertCreated();
});

it('protects the Admin role from lock-out', function (): void {
    $admin = roleOf($this->a->id, 'Admin');

    asUser($this->admin)->patchJson("/api/v1/roles/{$admin->id}", ['permissions' => []], Identity::headers($this->a))->assertStatus(403);
    asUser($this->admin)->patchJson("/api/v1/roles/{$admin->id}", ['name' => 'Boss'], Identity::headers($this->a))->assertStatus(403);
    asUser($this->admin)->deleteJson("/api/v1/roles/{$admin->id}", [], Identity::headers($this->a))->assertStatus(403);
    asUser($this->admin)->patchJson("/api/v1/roles/{$admin->id}", ['description' => 'Full access'], Identity::headers($this->a))->assertOk();
});

it('gates role management by permission', function (): void {
    asUser($this->viewer)->getJson('/api/v1/roles', Identity::headers($this->a))->assertStatus(403);
    asUser($this->viewer)->postJson('/api/v1/roles', ['name' => 'Mine'], Identity::headers($this->a, idempotent: true))->assertStatus(403);
    asUser($this->viewer)->getJson('/api/v1/permissions', Identity::headers($this->a))->assertStatus(403);
});

it('serves the permission catalog grouped by module', function (): void {
    $groups = asUser($this->admin)->getJson('/api/v1/permissions', Identity::headers($this->a))
        ->assertOk()->assertJsonStructure(['data' => [['module', 'permissions']]])->json('data');

    $byModule = collect($groups)->pluck('permissions', 'module');
    expect($byModule['identity'])->toContain('users.view', 'roles.assign', 'audit.export')
        ->and($byModule['organization'])->toContain('branches.create')
        ->and($byModule['workflow'])->toBe(['approval_flows.manage', 'approvals.decide', 'approvals.view'])
        ->and(collect($groups)->flatMap(fn (array $g): array => $g['permissions'])->every(fn (string $p): bool => preg_match('/^[a-z_]+(\.[a-z_]+)+$/', $p) === 1))->toBeTrue()
        ->and(app(PermissionCatalog::class)->all())->toHaveCount(collect($groups)->sum(fn (array $g): int => count($g['permissions'])));
});

it('reflects role permissions in /auth/me per company', function (): void {
    Identity::join($this->viewer, $this->b, ['HR']);

    $permissions = asUser($this->viewer)->getJson('/api/v1/auth/me')->assertOk()->json('data.permissions');

    expect($permissions[$this->a->id])->toContain('companies.view')->not->toContain('users.create')
        ->and($permissions[$this->b->id])->toContain('users.create');
});
