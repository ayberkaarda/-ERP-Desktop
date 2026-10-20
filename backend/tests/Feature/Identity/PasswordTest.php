<?php

declare(strict_types=1);

use App\Modules\Identity\Models\UserSession;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Testing\TestResponse;
use Tests\Support\Identity;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Identity::boot();
    $this->company = Identity::company();
    $this->user = Identity::member($this->company, ['Admin'], ['email' => 'selin.kaya@example.com', 'name' => 'Selin Kaya']);
});

function changePassword(array $payload): TestResponse
{
    return test()->actingAs(test()->user)->postJson('/api/v1/auth/password/change', array_merge([
        'current_password' => Identity::PASSWORD,
        'password' => 'a-brand-new-passphrase',
        'password_confirmation' => 'a-brand-new-passphrase',
    ], $payload), Identity::headers());
}

it('enforces the password policy', function (array $payload, string $field): void {
    changePassword($payload)->assertStatus(422)->assertJsonValidationErrors([$field], 'errors.fields');
})->with([
    'too short' => [['password' => 'short-pass1', 'password_confirmation' => 'short-pass1'], 'password'],
    'equals email' => [['password' => 'selin.kaya@example.com', 'password_confirmation' => 'selin.kaya@example.com'], 'password'],
    'equals name' => [['password' => 'selin kaya   ', 'password_confirmation' => 'selin kaya   '], 'password'],
    'not confirmed' => [['password_confirmation' => 'something-else-entirely'], 'password'],
    'same as current' => [['password' => Identity::PASSWORD, 'password_confirmation' => Identity::PASSWORD], 'password'],
    'wrong current' => [['current_password' => 'not-my-password!'], 'current_password'],
]);

it('changes the password, clears the forced flag and ends other sessions', function (): void {
    $this->user->forceFill(['must_change_password' => true])->save();
    UserSession::query()->create([
        'user_id' => $this->user->id, 'session_hash' => str_repeat('a', 64),
        'session_id_encrypted' => encrypt('other-session', false), 'last_active_at' => now(),
    ]);
    $this->user->createToken('desk', ['desktop']);

    changePassword([])->assertNoContent();

    $user = $this->user->fresh();
    expect(Hash::check('a-brand-new-passphrase', (string) $user?->password))->toBeTrue()
        ->and($user?->must_change_password)->toBeFalse()
        ->and(UserSession::query()->where('session_hash', str_repeat('a', 64))->exists())->toBeFalse()
        ->and($this->user->tokens()->count())->toBe(0);
});

it('blocks everything but me, logout and password change while a change is forced', function (): void {
    $this->user->forceFill(['must_change_password' => true])->save();

    $this->actingAs($this->user)->getJson('/api/v1/users', Identity::headers($this->company))
        ->assertStatus(403)->assertJsonPath('errors.code', 'PASSWORD_CHANGE_REQUIRED');
    $this->actingAs($this->user)->getJson('/api/v1/companies', Identity::headers())
        ->assertStatus(403)->assertJsonPath('errors.code', 'PASSWORD_CHANGE_REQUIRED');
    $this->actingAs($this->user)->postJson('/api/v1/auth/two-factor/setup', [], Identity::headers())
        ->assertStatus(403);

    $this->actingAs($this->user)->getJson('/api/v1/auth/me', Identity::headers())
        ->assertOk()->assertJsonPath('data.user.must_change_password', true);
});
