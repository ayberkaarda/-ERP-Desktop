<?php

declare(strict_types=1);

use App\Core\Company\MembershipChecker;
use App\Models\User;
use App\Modules\Identity\Broadcasting\CompanyPresenceChannel;
use App\Modules\Identity\Broadcasting\UserChannel;
use App\Modules\Identity\Database\seeders\SuperAdminSeeder;
use App\Modules\Identity\Services\IdentityMembershipChecker;
use App\Modules\Organization\Contracts\CompanyDirectory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Route;
use Tests\Support\Identity;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Identity::boot();
    $this->a = Identity::company();
    $this->b = Identity::company();
    $this->user = Identity::member($this->a, ['Viewer']);
});

afterEach(function (): void {
    foreach (['ADMIN_EMAIL', 'ADMIN_PASSWORD'] as $key) {
        putenv($key);
        unset($_ENV[$key], $_SERVER[$key]);
    }
});

it('binds a real membership checker that honours membership and account state', function (): void {
    $checker = app(MembershipChecker::class);

    expect($checker)->toBeInstanceOf(IdentityMembershipChecker::class)
        ->and($checker->isMember($this->user->id, $this->a->id))->toBeTrue()
        ->and($checker->isMember($this->user->id, $this->b->id))->toBeFalse();

    app(CompanyDirectory::class)->setMembership($this->user->id, $this->a->id, false);
    expect($checker->isMember($this->user->id, $this->a->id))->toBeFalse();

    app(CompanyDirectory::class)->setMembership($this->user->id, $this->a->id, true);
    $this->user->forceFill(['is_active' => false])->save();
    expect($checker->isMember($this->user->id, $this->a->id))->toBeFalse();

    $this->a->forceFill(['is_active' => false])->save();
    $root = User::factory()->superAdmin()->create();
    expect($checker->isMember($root->id, $this->b->id))->toBeTrue()
        ->and($checker->isMember($root->id, $this->a->id))->toBeFalse();
});

it('authorizes the private user channel for that user only', function (): void {
    $other = Identity::member($this->a, ['Viewer']);
    $channel = new UserChannel;

    expect($channel->join($this->user, $this->user->id))->toBeTrue()
        ->and($channel->join($other, $this->user->id))->toBeFalse()
        ->and($channel->join(null, $this->user->id))->toBeFalse();
});

it('authorizes the company presence channel for members with minimal member info', function (): void {
    $channel = app(CompanyPresenceChannel::class);

    expect($channel->join($this->user, $this->a->id))->toBe(['id' => $this->user->id, 'name' => $this->user->name])
        ->and($channel->join($this->user, $this->b->id))->toBeFalse()
        ->and($channel->join($this->user, 'not-a-uuid'))->toBeFalse();
});

it('registers broadcasting auth under the api prefix and the channels', function (): void {
    expect(Route::has('broadcasting.auth') || collect(Route::getRoutes()->getRoutes())->contains(fn ($r): bool => $r->uri() === 'api/v1/broadcasting/auth'))->toBeTrue()
        ->and(collect(Route::getRoutes()->getRoutes())->first(fn ($r): bool => $r->uri() === 'api/v1/broadcasting/auth')?->gatherMiddleware())->toContain('auth:sanctum');

    $this->postJson('/api/v1/broadcasting/auth', ['channel_name' => 'private-user.'.$this->user->id])->assertStatus(401);
});

it('lets super admins pass every ability, but never inactive ones', function (): void {
    $root = User::factory()->superAdmin()->create();

    expect(Gate::forUser($root)->allows('anything.at_all'))->toBeTrue()
        ->and(Gate::forUser($this->user)->allows('anything.at_all'))->toBeFalse();

    $root->forceFill(['is_active' => false])->save();
    expect(Gate::forUser($root)->allows('anything.at_all'))->toBeFalse();
});

it('seeds the first super admin only from the environment', function (): void {
    expect(fn () => (new SuperAdminSeeder)->run())->toThrow(RuntimeException::class, 'ADMIN_EMAIL');

    putenv('ADMIN_EMAIL=root@example.com');
    putenv('ADMIN_PASSWORD=short');
    expect(fn () => (new SuperAdminSeeder)->run())->toThrow(RuntimeException::class);

    putenv('ADMIN_PASSWORD=a-long-and-unique-passphrase');
    (new SuperAdminSeeder)->run();
    (new SuperAdminSeeder)->run();

    $root = User::query()->where('email', 'root@example.com')->sole();
    expect($root->is_super_admin)->toBeTrue()
        ->and($root->must_change_password)->toBeFalse();
});

it('keeps secrets out of user JSON', function (): void {
    $json = json_encode($this->user->forceFill(['two_factor_secret' => 'SECRET', 'two_factor_recovery_codes' => ['x']])->toArray());

    expect($json)->not->toContain('SECRET')->not->toContain('"password"')->not->toContain('remember_token');
});
