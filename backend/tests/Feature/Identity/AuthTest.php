<?php

declare(strict_types=1);

use App\Models\User;
use App\Modules\Identity\Models\SessionLog;
use App\Modules\Identity\Models\UserSession;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\Support\Identity;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Identity::boot();
    $this->company = Identity::company(['name' => 'Acme']);
    $this->user = Identity::member($this->company, ['Sales'], ['email' => 'ayse@example.com', 'name' => 'Ayşe']);
});

function login(string $email, string $password, array $server = []): TestResponse
{
    Identity::fresh();

    return test()->withServerVariables($server)->postJson('/api/v1/auth/login', ['email' => $email, 'password' => $password], Identity::headers());
}

it('logs in with a session and returns the user', function (): void {
    $response = login('AYSE@example.com', Identity::PASSWORD)
        ->assertOk()
        ->assertJsonPath('data.two_factor_required', false)
        ->assertJsonPath('data.user.id', $this->user->id)
        ->assertJsonPath('data.user.email', 'ayse@example.com')
        ->assertJsonMissingPath('data.user.password');

    expect(SessionLog::query()->where('user_id', $this->user->id)->where('event', 'login')->count())->toBe(1)
        ->and(UserSession::query()->where('user_id', $this->user->id)->count())->toBe(1)
        ->and(Identity::sessionCookie($response))->toBeString();
});

it('serves /auth/me from the session cookie exactly per contract', function (): void {
    $cookie = Identity::sessionCookie(login('ayse@example.com', Identity::PASSWORD));
    Identity::fresh();

    $this->withCredentials()->withCookie((string) config('session.cookie'), $cookie)
        ->getJson('/api/v1/auth/me', Identity::headers())
        ->assertOk()
        ->assertExactJsonStructure([
            'data' => [
                'user' => ['id', 'name', 'email', 'locale', 'is_super_admin', 'must_change_password', 'two_factor_enabled'],
                'companies' => [['id', 'name', 'role_names']],
                'permissions' => [$this->company->id],
            ],
        ])
        ->assertJsonPath('data.companies.0.id', $this->company->id)
        ->assertJsonPath('data.companies.0.role_names', ['Sales'])
        ->assertJsonPath('data.user.two_factor_enabled', false);
});

it('returns permissions as an object even when the user has no company', function (): void {
    $loner = User::factory()->create();

    $this->actingAs($loner)->getJson('/api/v1/auth/me', Identity::headers())
        ->assertOk()
        ->assertJsonPath('data.companies', []);

    expect($this->actingAs($loner)->getJson('/api/v1/auth/me')->getContent())->toContain('"permissions":{}');
});

it('answers wrong passwords and unknown emails identically', function (): void {
    $wrong = login('ayse@example.com', 'not-the-password')->assertStatus(422)->assertJsonPath('errors.code', 'VALIDATION_ERROR');
    $unknown = login('nobody@example.com', 'not-the-password')->assertStatus(422);

    expect($unknown->json())->toBe($wrong->json())
        ->and(SessionLog::query()->where('event', 'failed')->count())->toBe(2);
});

it('locks out after 5 failures per email and ip, even for the right password', function (): void {
    foreach (range(1, 5) as $_) {
        login('ayse@example.com', 'wrong-password-123')->assertStatus(422);
    }

    login('ayse@example.com', Identity::PASSWORD)
        ->assertStatus(429)
        ->assertJsonPath('errors.code', 'TOO_MANY_ATTEMPTS')
        ->assertHeader('Retry-After');

    // Another address is not locked; neither is another email.
    login('ayse@example.com', Identity::PASSWORD, ['REMOTE_ADDR' => '10.9.8.7'])->assertOk();

    expect(SessionLog::query()->where('event', 'lockout')->count())->toBe(1);
});

it('locks unknown emails the same way, without revealing they do not exist', function (): void {
    foreach (range(1, 5) as $_) {
        login('ghost@example.com', 'wrong-password-123')->assertStatus(422);
    }

    login('ghost@example.com', 'wrong-password-123')->assertStatus(429)->assertJsonPath('errors.code', 'TOO_MANY_ATTEMPTS');
});

it('refuses deactivated users only after a correct password', function (): void {
    $this->user->forceFill(['is_active' => false])->save();

    login('ayse@example.com', 'wrong-password-123')->assertStatus(422);
    login('ayse@example.com', Identity::PASSWORD)->assertStatus(403)->assertJsonPath('errors.code', 'USER_DEACTIVATED');
});

it('needs a browser session to log in', function (): void {
    $this->postJson('/api/v1/auth/login', ['email' => 'ayse@example.com', 'password' => Identity::PASSWORD])
        ->assertStatus(400)
        ->assertJsonPath('errors.code', 'HTTP_ERROR');
});

it('logs out and the session no longer authenticates', function (): void {
    $cookie = Identity::sessionCookie(login('ayse@example.com', Identity::PASSWORD));
    Identity::fresh();

    $this->withCredentials()->withCookie((string) config('session.cookie'), $cookie)
        ->postJson('/api/v1/auth/logout', [], Identity::headers())
        ->assertNoContent();

    Identity::fresh();
    $this->withCredentials()->withCookie((string) config('session.cookie'), $cookie)
        ->getJson('/api/v1/auth/me', Identity::headers())
        ->assertStatus(401);

    expect(SessionLog::query()->where('event', 'logout')->count())->toBe(1)
        ->and(UserSession::query()->count())->toBe(0);
});

it('requires authentication for /auth/me', function (): void {
    $this->getJson('/api/v1/auth/me')->assertStatus(401)->assertJsonPath('errors.code', 'UNAUTHENTICATED');
});

it('validates the login payload', function (): void {
    $this->postJson('/api/v1/auth/login', ['email' => 'not-an-email'], Identity::headers())
        ->assertStatus(422)
        ->assertJsonValidationErrors(['email', 'password'], 'errors.fields');
});
