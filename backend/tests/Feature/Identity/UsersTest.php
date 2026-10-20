<?php

declare(strict_types=1);

use App\Models\User;
use App\Modules\Identity\Events\SessionRevoked;
use App\Modules\Identity\Models\Activity;
use App\Modules\Identity\Models\Role;
use App\Modules\Identity\Models\UserSession;
use App\Modules\Organization\Contracts\CompanyDirectory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Tests\Support\Identity;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Identity::boot();
    $this->a = Identity::company(['name' => 'Alpha']);
    $this->b = Identity::company(['name' => 'Beta']);
    $this->adminA = Identity::member($this->a, ['Admin'], ['email' => 'admin.a@example.com']);
    $this->salesA = Identity::member($this->a, ['Sales']);
    $this->memberA = Identity::member($this->a, ['Viewer'], ['name' => 'Member A']);
    $this->adminB = Identity::member($this->b, ['Admin']);
    $this->userB = Identity::member($this->b, ['Viewer']);
});

function as_(User $user): mixed
{
    Identity::fresh();

    return test()->actingAs($user);
}

it('lists only members of the active company', function (): void {
    $ids = as_($this->adminA)->getJson('/api/v1/users?per_page=100', Identity::headers($this->a))
        ->assertOk()
        ->assertJsonStructure(['data' => [['id', 'name', 'email', 'is_active', 'roles']], 'meta' => ['pagination']])
        ->json('data.*.id');

    expect($ids)->toContain($this->memberA->id)->not->toContain($this->userB->id)->not->toContain($this->adminB->id);
});

it('requires users.view and membership of the header company', function (): void {
    as_($this->salesA)->getJson('/api/v1/users', Identity::headers($this->a))->assertStatus(403);
    as_($this->adminA)->getJson('/api/v1/users', Identity::headers($this->b))
        ->assertStatus(403)->assertJsonPath('errors.code', 'COMPANY_FORBIDDEN');
});

it('answers 404 for users of another company on every user endpoint (IDOR)', function (): void {
    $id = $this->userB->id;
    $h = Identity::headers($this->a);

    as_($this->adminA)->getJson("/api/v1/users/{$id}", $h)->assertNotFound();
    as_($this->adminA)->patchJson("/api/v1/users/{$id}", ['name' => 'x'], $h)->assertNotFound();
    as_($this->adminA)->patchJson("/api/v1/users/{$id}/status", ['is_active' => false], $h)->assertNotFound();
    as_($this->adminA)->postJson("/api/v1/users/{$id}/password-reset", ['password' => 'hijacked-password-1'], $h)->assertNotFound();
    as_($this->adminA)->deleteJson("/api/v1/users/{$id}", [], $h)->assertNotFound();
    as_($this->adminA)->putJson("/api/v1/users/{$id}/roles", ['company_id' => $this->a->id, 'roles' => ['Admin']], $h)->assertStatus(403);
    as_($this->adminA)->putJson("/api/v1/users/{$id}/roles", ['company_id' => $this->b->id, 'roles' => ['Viewer']], $h)->assertStatus(403);

    expect($this->userB->fresh()?->name)->not->toBe('x')
        ->and($this->userB->fresh()?->is_active)->toBeTrue();
});

it('creates a member with a temporary password and roles', function (): void {
    $payload = ['name' => 'New Person', 'email' => 'New.Person@Example.com', 'password' => 'temporary-pass-123', 'roles' => ['Sales']];

    as_($this->adminA)->postJson('/api/v1/users', $payload, Identity::headers($this->a))
        ->assertStatus(400)->assertJsonPath('errors.code', 'IDEMPOTENCY_KEY_REQUIRED');

    $response = as_($this->adminA)->postJson('/api/v1/users', $payload, Identity::headers($this->a, idempotent: true))
        ->assertCreated()
        ->assertJsonPath('data.email', 'new.person@example.com')
        ->assertJsonPath('data.must_change_password', true)
        ->assertJsonPath('data.roles.0.name', 'Sales');

    $id = (string) $response->json('data.id');
    expect(app(CompanyDirectory::class)->isActiveMember($id, $this->a->id))->toBeTrue()
        ->and(app(CompanyDirectory::class)->hasMembership($id, $this->b->id))->toBeFalse();

    as_($this->adminA)->postJson('/api/v1/users', [...$payload, 'password' => 'short'], Identity::headers($this->a, idempotent: true))
        ->assertStatus(422);
});

it('updates a member and audits the change with before and after', function (): void {
    as_($this->adminA)->patchJson("/api/v1/users/{$this->memberA->id}", ['name' => 'Renamed'], Identity::headers($this->a))
        ->assertOk()->assertJsonPath('data.name', 'Renamed');

    $entry = Activity::withoutCompanyScope()->where('subject_id', $this->memberA->id)->where('event', 'updated')->latest('created_at')->firstOrFail();
    expect($entry->company_id)->toBe($this->a->id)
        ->and($entry->causer_id)->toBe($this->adminA->id)
        ->and($entry->attribute_changes?->get('old'))->toBe(['name' => 'Member A'])
        ->and($entry->attribute_changes?->get('attributes'))->toBe(['name' => 'Renamed']);
});

it('needs the permission in every company of a shared user', function (): void {
    $shared = Identity::member($this->a, ['Viewer']);
    Identity::join($shared, $this->b, ['Viewer']);

    as_($this->adminA)->patchJson("/api/v1/users/{$shared->id}", ['name' => 'nope'], Identity::headers($this->a))->assertStatus(403);
    as_($this->adminA)->patchJson("/api/v1/users/{$shared->id}/status", ['is_active' => false], Identity::headers($this->a))->assertStatus(403);

    Identity::join($this->adminA, $this->b, ['Admin']);
    as_($this->adminA)->patchJson("/api/v1/users/{$shared->id}", ['name' => 'ok'], Identity::headers($this->a))->assertOk();
});

it('keeps super admin status and super admins out of reach of company admins', function (): void {
    $root = Identity::member($this->a, [], ['is_super_admin' => true]);

    as_($this->adminA)->patchJson("/api/v1/users/{$this->memberA->id}", ['is_super_admin' => true], Identity::headers($this->a))->assertStatus(403);
    as_($this->adminA)->patchJson("/api/v1/users/{$root->id}", ['name' => 'x'], Identity::headers($this->a))->assertStatus(403);
    as_($this->adminA)->patchJson("/api/v1/users/{$root->id}/status", ['is_active' => false], Identity::headers($this->a))->assertStatus(403);

    expect($this->memberA->fresh()?->is_super_admin)->toBeFalse();
});

it('deactivates: revokes sessions and tokens at once and broadcasts session.revoked', function (): void {
    Event::fake([SessionRevoked::class]);
    $this->memberA->createToken('desk', ['desktop']);
    UserSession::query()->create([
        'user_id' => $this->memberA->id, 'session_hash' => hash('sha256', 'sid-1'),
        'session_id_encrypted' => encrypt('sid-1', false), 'last_active_at' => now(),
    ]);
    DB::table('sessions')->insert(['id' => 'sid-1', 'user_id' => $this->memberA->id, 'payload' => base64_encode(serialize([])), 'last_activity' => time()]);

    as_($this->adminA)->patchJson("/api/v1/users/{$this->memberA->id}/status", ['is_active' => false], Identity::headers($this->a))
        ->assertOk()->assertJsonPath('data.is_active', false);

    expect(DB::table('sessions')->where('id', 'sid-1')->exists())->toBeFalse()
        ->and(UserSession::query()->where('user_id', $this->memberA->id)->exists())->toBeFalse()
        ->and($this->memberA->tokens()->count())->toBe(0);

    Event::assertDispatched(SessionRevoked::class, fn (SessionRevoked $e): bool => $e->userId === $this->memberA->id
        && $e->broadcastAs() === 'session.revoked'
        && $e->broadcastOn()[0]->name === 'private-user.'.$this->memberA->id);

    // Any request that still carries the user is refused, on every module's routes.
    as_($this->memberA->fresh() ?? $this->memberA)->getJson('/api/v1/auth/me', Identity::headers())
        ->assertStatus(403)->assertJsonPath('errors.code', 'USER_DEACTIVATED');
    as_($this->memberA->fresh() ?? $this->memberA)->getJson('/api/v1/departments', Identity::headers($this->a))
        ->assertStatus(403)->assertJsonPath('errors.code', 'USER_DEACTIVATED');

    as_($this->adminA)->patchJson("/api/v1/users/{$this->memberA->id}/status", ['is_active' => true], Identity::headers($this->a))
        ->assertOk()->assertJsonPath('data.is_active', true);
});

it('resets a password: forces a change and revokes access', function (): void {
    Event::fake([SessionRevoked::class]);
    $this->memberA->createToken('desk', ['desktop']);

    as_($this->adminA)->postJson("/api/v1/users/{$this->memberA->id}/password-reset", ['password' => 'Member A'], Identity::headers($this->a))
        ->assertStatus(422);
    as_($this->adminA)->postJson("/api/v1/users/{$this->memberA->id}/password-reset", ['password' => 'reset-by-admin-1'], Identity::headers($this->a))
        ->assertNoContent();

    $user = $this->memberA->fresh();
    expect($user?->must_change_password)->toBeTrue()
        ->and(Hash::check('reset-by-admin-1', (string) $user?->password))->toBeTrue()
        ->and($this->memberA->tokens()->count())->toBe(0);
    Event::assertDispatched(SessionRevoked::class);
});

it('soft deletes a member', function (): void {
    as_($this->adminA)->deleteJson("/api/v1/users/{$this->memberA->id}", [], Identity::headers($this->a))->assertNoContent();

    expect(User::query()->find($this->memberA->id))->toBeNull()
        ->and(User::withTrashed()->find($this->memberA->id))->not->toBeNull();
});

it('limits even super admins: no deactivating, deleting or resetting themselves', function (): void {
    $root = User::factory()->superAdmin()->create();

    as_($root)->patchJson("/api/v1/users/{$root->id}/status", ['is_active' => false], Identity::headers($this->a))->assertNotFound();

    Identity::join($root, $this->a, []);
    as_($root)->patchJson("/api/v1/users/{$root->id}/status", ['is_active' => false], Identity::headers($this->a))->assertStatus(403);
    as_($root)->deleteJson("/api/v1/users/{$root->id}", [], Identity::headers($this->a))->assertStatus(403);
    as_($root)->postJson("/api/v1/users/{$root->id}/password-reset", ['password' => 'another-password-1'], Identity::headers($this->a))->assertStatus(403);

    expect($root->fresh()?->is_active)->toBeTrue();
});

it('lets a super admin enter any company and manage its users without membership', function (): void {
    $root = User::factory()->superAdmin()->create();

    as_($root)->getJson('/api/v1/users', Identity::headers($this->b))->assertOk();
    as_($root)->patchJson("/api/v1/users/{$this->userB->id}", ['name' => 'By Root'], Identity::headers($this->b))->assertOk();

    // A deactivated super admin is just a deactivated user.
    $root->forceFill(['is_active' => false])->save();
    as_($root)->getJson('/api/v1/users', Identity::headers($this->b))->assertStatus(403)->assertJsonPath('errors.code', 'USER_DEACTIVATED');
});

it('assigns roles per company and isolates role ids between companies', function (): void {
    as_($this->adminA)->putJson("/api/v1/users/{$this->memberA->id}/roles", ['company_id' => $this->a->id, 'roles' => ['Sales', 'HR']], Identity::headers())
        ->assertOk()->assertJsonPath('data.roles', ['HR', 'Sales']);

    as_($this->memberA)->getJson('/api/v1/auth/me', Identity::headers())
        ->assertJsonPath('data.companies.0.role_names', ['HR', 'Sales']);

    $roleOfB = app(App\Core\Company\CompanyContext::class)->runAs($this->b->id, fn () => Role::query()->where('name', 'Admin')->firstOrFail());
    as_($this->adminA)->putJson("/api/v1/users/{$this->memberA->id}/roles", ['company_id' => $this->a->id, 'roles' => [$roleOfB->id]], Identity::headers())
        ->assertStatus(422);
    as_($this->adminA)->putJson("/api/v1/users/{$this->memberA->id}/roles", ['company_id' => $this->a->id, 'roles' => ['Nope']], Identity::headers())
        ->assertStatus(422);

    $entry = Activity::withoutCompanyScope()->where('subject_id', $this->memberA->id)->where('event', 'roles_synced')->orderByDesc('id')->firstOrFail();
    expect($entry->company_id)->toBe($this->a->id)
        ->and($entry->attribute_changes?->get('attributes'))->toBe(['roles' => ['HR', 'Sales']]);
});

it('removes company access when all roles are taken away', function (): void {
    as_($this->adminA)->putJson("/api/v1/users/{$this->memberA->id}/roles", ['company_id' => $this->a->id, 'roles' => []], Identity::headers())
        ->assertOk()->assertJsonPath('data.roles', []);

    as_($this->memberA)->getJson('/api/v1/departments', Identity::headers($this->a))
        ->assertStatus(403)->assertJsonPath('errors.code', 'COMPANY_FORBIDDEN');
});

it('needs roles.assign in the named company', function (): void {
    as_($this->salesA)->putJson("/api/v1/users/{$this->memberA->id}/roles", ['company_id' => $this->a->id, 'roles' => ['Admin']], Identity::headers())
        ->assertStatus(403);
});
