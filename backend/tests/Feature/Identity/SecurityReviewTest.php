<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Identity\Events\MembershipRevoked;
use App\Modules\Identity\Http\Middleware\EnforceAccountState;
use App\Modules\Identity\Models\Role;
use App\Modules\Identity\Models\UserDevice;
use App\Modules\Identity\Services\CredentialVerifier;
use App\Modules\Identity\Services\PermissionCatalog;
use App\Modules\Identity\Services\TwoFactorService;
use Illuminate\Contracts\Hashing\Hasher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use PragmaRX\Google2FA\Google2FA;
use Tests\Support\Actors;
use Tests\Support\Identity;

uses(RefreshDatabase::class);

/** Routes reachable without a signed-in user. */
const PUBLIC_ROUTES = ['auth.login', 'auth.two-factor.verify', 'auth.device', 'auth.device.refresh', 'health', 'meta'];

beforeEach(function (): void {
    Identity::boot();
    $this->company = Identity::company();
    $this->admin = Identity::member($this->company, ['Admin'], ['email' => 'admin@example.com']);
});

function secAs(User $user): mixed
{
    Identity::fresh();

    return test()->actingAs($user);
}

function secRole(string $companyId, string $name): Role
{
    return app(CompanyContext::class)->runAs($companyId, fn (): Role => Role::query()->where('name', $name)->firstOrFail());
}

/**
 * @return list<RoutingRoute>
 */
function apiRoutes(): array
{
    return array_values(array_filter(Route::getRoutes()->getRoutes(), fn (RoutingRoute $r): bool => str_starts_with($r->uri(), 'api/v1/')));
}

// 1. Roles may only hold permissions the editor holds; super-admin-only permissions never.
it('refuses to grant permissions the actor does not hold', function (): void {
    $editor = Actors::user(['roles.create', 'roles.update', 'audit.view'], $this->company->id);

    secAs($this->admin)->postJson('/api/v1/roles', ['name' => 'Wrecker', 'permissions' => ['companies.delete']], Identity::headers($this->company, idempotent: true))
        ->assertStatus(403);
    secAs($editor)->postJson('/api/v1/roles', ['name' => 'Exporter', 'permissions' => ['audit.export']], Identity::headers($this->company, idempotent: true))
        ->assertStatus(403);
    $id = secAs($editor)->postJson('/api/v1/roles', ['name' => 'Reader', 'permissions' => ['audit.view']], Identity::headers($this->company, idempotent: true))
        ->assertCreated()->json('data.id');
    secAs($editor)->patchJson("/api/v1/roles/{$id}", ['permissions' => ['audit.view', 'users.delete']], Identity::headers($this->company))
        ->assertStatus(403);

    $root = User::factory()->superAdmin()->create();
    secAs($root)->patchJson("/api/v1/roles/{$id}", ['permissions' => ['audit.view', 'companies.delete']], Identity::headers($this->company))
        ->assertOk();
});

// 2. Role assignment cannot escalate.
it('stops role assignment from escalating privileges', function (): void {
    // Holds exactly what Sales and Viewer hold (from the module catalog) plus roles.assign: enough to
    // move someone from Viewer to Sales, never enough for HR or Admin.
    $catalog = app(PermissionCatalog::class);
    $assigner = Actors::user(array_values(array_unique(['roles.assign', ...$catalog->grantsFor('Sales'), ...$catalog->grantsFor('Viewer')])), $this->company->id);
    expect(array_diff($catalog->grantsFor('HR'), $catalog->grantsFor('Sales'), $catalog->grantsFor('Viewer')))->not->toBe([]);
    $target = Identity::member($this->company, ['Viewer']);
    $put = fn (User $actor, User $who, array $roles) => secAs($actor)->putJson("/api/v1/users/{$who->id}/roles", ['company_id' => $this->company->id, 'roles' => $roles], Identity::headers());

    $put($assigner, $assigner, ['Admin'])->assertStatus(403);
    $put($assigner, $target, ['Admin'])->assertStatus(403);
    $put($assigner, $target, ['HR'])->assertStatus(403);
    $put($assigner, $target, ['Sales'])->assertOk();
    $put($this->admin, $this->admin, ['Viewer'])->assertStatus(403);
    $put($this->admin, $target, ['Admin'])->assertOk();

    $other = Identity::member($this->company, ['Admin']);
    $put($assigner, $other, ['Viewer'])->assertStatus(403);

    expect(secRole($this->company->id, 'Admin')->users()->pluck('id')->all())->not->toContain($assigner->id);
});

// 3. A forced password change blocks every authenticated route of every module.
it('enforces the forced password change on every authenticated api route', function (): void {
    $user = Identity::member($this->company, ['Admin'], ['must_change_password' => true]);
    $checked = 0;

    foreach (apiRoutes() as $route) {
        $name = $route->getName();

        if (in_array($name, PUBLIC_ROUTES, true) || in_array($name, EnforceAccountState::PASSWORD_CHANGE_ALLOWLIST, true)) {
            continue;
        }

        $uri = '/'.preg_replace('/\{[^}]+\}/', (string) Str::uuid7(), $route->uri());
        $method = collect($route->methods())->reject(fn (string $m): bool => $m === 'HEAD')->first();

        secAs($user)->json((string) $method, $uri, [], Identity::headers($this->company, idempotent: true))
            ->assertStatus(403)
            ->assertJsonPath('errors.code', 'PASSWORD_CHANGE_REQUIRED');
        $checked++;
    }

    expect($checked)->toBeGreaterThan(40);
    secAs($user)->getJson('/api/v1/auth/me', Identity::headers())->assertOk();
});

it('requires authentication on every api route except the public ones', function (): void {
    foreach (apiRoutes() as $route) {
        if (in_array($route->getName(), PUBLIC_ROUTES, true)) {
            continue;
        }

        expect(collect($route->gatherMiddleware())->contains(fn (mixed $m): bool => is_string($m) && str_starts_with($m, 'auth:sanctum')))
            ->toBeTrue("Route {$route->uri()} lacks auth:sanctum");
    }
});

// 4. A pending 2FA challenge dies with a credential change.
it('voids a pending two-factor challenge after an admin password reset', function (): void {
    $user = Identity::member($this->company, ['Viewer'], ['email' => 'otp@example.com']);
    $secret = app(Google2FA::class)->generateSecretKey(32);
    $user->forceFill(['two_factor_secret' => $secret, 'two_factor_confirmed_at' => now()])->save();

    Identity::fresh();
    $cookie = Identity::sessionCookie($this->postJson('/api/v1/auth/login', ['email' => 'otp@example.com', 'password' => Identity::PASSWORD], Identity::headers())->assertOk());

    secAs($this->admin)->postJson("/api/v1/users/{$user->id}/password-reset", ['password' => 'admin-chosen-pass-1'], Identity::headers($this->company))
        ->assertNoContent();

    Identity::fresh();
    $this->withCredentials()->withCookie((string) config('session.cookie'), $cookie)
        ->postJson('/api/v1/auth/two-factor/verify', ['code' => app(Google2FA::class)->getCurrentOtp($secret)], Identity::headers())
        ->assertStatus(401);
});

// 5. Recovery codes are consumed atomically against the stored list, not a stale copy.
it('never resurrects a consumed recovery code through a stale user copy', function (): void {
    $user = Identity::member($this->company, ['Viewer']);
    $user->forceFill([
        'two_factor_secret' => 'JBSWY3DPEHPK3PXP',
        'two_factor_confirmed_at' => now(),
        'two_factor_recovery_codes' => [TwoFactorService::hashCode('AAAAA-AAAAA'), TwoFactorService::hashCode('BBBBB-BBBBB')],
    ])->save();
    $first = User::query()->findOrFail($user->id);
    $stale = User::query()->findOrFail($user->id);
    $service = app(TwoFactorService::class);

    expect($service->useRecoveryCode($first, 'AAAAA-AAAAA'))->toBeTrue()
        ->and($service->useRecoveryCode($stale, 'AAAAA-AAAAA'))->toBeFalse()
        ->and($service->useRecoveryCode($stale, 'BBBBB-BBBBB'))->toBeTrue()
        ->and(User::query()->findOrFail($user->id)->two_factor_recovery_codes)->toBe([]);
});

// 6. Bearer logout ends the token and its device.
it('revokes the current device token on bearer logout', function (): void {
    $user = Identity::member($this->company, ['Viewer'], ['email' => 'desk@example.com']);
    Identity::fresh();
    $token = (string) $this->postJson('/api/v1/auth/device', [
        'email' => 'desk@example.com', 'password' => Identity::PASSWORD, 'device_name' => 'PC', 'fingerprint' => 'fp-1234567890abcdef',
    ])->assertOk()->json('data.token');

    Identity::fresh();
    $this->withToken($token)->postJson('/api/v1/auth/logout')->assertNoContent();

    expect($user->tokens()->count())->toBe(0)
        ->and(UserDevice::query()->where('user_id', $user->id)->count())->toBe(0);

    Identity::fresh();
    $this->withToken($token)->getJson('/api/v1/auth/me')->assertStatus(401);
});

// 7. Losing a membership tells the client to leave the company channels.
it('broadcasts membership.revoked when the last role in a company is removed', function (): void {
    Event::fake([MembershipRevoked::class]);
    $target = Identity::member($this->company, ['Viewer']);

    secAs($this->admin)->putJson("/api/v1/users/{$target->id}/roles", ['company_id' => $this->company->id, 'roles' => []], Identity::headers())
        ->assertOk();

    Event::assertDispatched(MembershipRevoked::class, fn (MembershipRevoked $e): bool => $e->userId === $target->id
        && $e->companyId === $this->company->id
        && $e->broadcastAs() === 'membership.revoked');
});

// 8. Unknown emails verify against a stored dummy hash, never computing one per attempt.
it('checks unknown emails against the cached dummy hash', function (): void {
    $dummy = Hash::make('never-a-password');
    Cache::forever(CredentialVerifier::DUMMY_HASH_KEY, $dummy);
    $recorder = new class(app(Hasher::class)) implements Hasher
    {
        /** @var list<string> */
        public array $calls = [];

        public function __construct(private readonly Hasher $inner) {}

        public function info($hashedValue): array
        {
            return $this->inner->info($hashedValue);
        }

        public function make($value, array $options = []): string
        {
            $this->calls[] = 'make';

            return $this->inner->make($value, $options);
        }

        public function check($value, $hashedValue, array $options = []): bool
        {
            $this->calls[] = 'check:'.$hashedValue;

            return $this->inner->check($value, $hashedValue, $options);
        }

        public function needsRehash($hashedValue, array $options = []): bool
        {
            return $this->inner->needsRehash($hashedValue, $options);
        }
    };
    app()->instance(Hasher::class, $recorder);

    Identity::fresh();
    $this->postJson('/api/v1/auth/login', ['email' => 'ghost@example.com', 'password' => 'whatever-password'], Identity::headers())
        ->assertStatus(422);

    expect($recorder->calls)->toBe(['check:'.$dummy]);
});

// 9. Changing the second factor needs the current password.
it('requires the current password for two-factor setup and confirmation', function (): void {
    secAs($this->admin)->postJson('/api/v1/auth/two-factor/setup', [], Identity::headers())->assertStatus(422);
    secAs($this->admin)->postJson('/api/v1/auth/two-factor/setup', ['password' => 'wrong-password-123'], Identity::headers())
        ->assertStatus(422)->assertJsonValidationErrors(['password'], 'errors.fields');
    $secret = secAs($this->admin)->postJson('/api/v1/auth/two-factor/setup', ['password' => Identity::PASSWORD], Identity::headers())
        ->assertOk()->json('data.secret');

    secAs($this->admin)->postJson('/api/v1/auth/two-factor/confirm', ['code' => app(Google2FA::class)->getCurrentOtp((string) $secret)], Identity::headers())
        ->assertStatus(422);
});
