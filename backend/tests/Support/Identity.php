<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Core\Company\CompanyContext;
use App\Models\User;
use App\Modules\Identity\Services\PermissionCatalog;
use App\Modules\Identity\Services\UserAdministration;
use App\Modules\Organization\Contracts\CompanyDirectory;
use App\Modules\Organization\Events\CompanyCreated;
use App\Modules\Organization\Models\Company;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;

/**
 * Fixtures for identity and organization feature tests.
 */
final class Identity
{
    public const string PASSWORD = 'correct-horse-battery-staple';

    public const string SPA = 'http://localhost';

    /**
     * Tests run without .env; cookies and encrypted columns need a key.
     */
    public static function boot(): void
    {
        if (! is_string(config('app.key')) || config('app.key') === '') {
            config(['app.key' => 'base64:'.base64_encode(random_bytes(32))]);
            app()->forgetInstance('encrypter');
        }

        // A persistent store, so fresh() can drop the in-memory session between requests; and a
        // stateful SPA origin independent of any local .env.
        config(['session.driver' => 'database', 'sanctum.stateful' => ['localhost'], 'session.domain' => null, 'session.secure' => false]);
        app('session')->forgetDrivers();
        app()->forgetInstance('session.store');

        app(PermissionCatalog::class)->sync();
    }

    /**
     * A company with its default roles, as POST /companies creates it.
     *
     * @param  array<string, mixed>  $attributes
     */
    public static function company(array $attributes = []): Company
    {
        $company = Company::factory()->create($attributes);
        CompanyCreated::dispatch($company->id);

        return $company;
    }

    /**
     * @param  list<string>  $roles
     * @param  array<string, mixed>  $attributes
     */
    public static function member(Company $company, array $roles = ['Admin'], array $attributes = []): User
    {
        $user = User::factory()->create(['password' => self::PASSWORD, ...$attributes]);
        self::join($user, $company, $roles);

        return $user;
    }

    /**
     * @param  list<string>  $roles
     */
    public static function join(User $user, Company $company, array $roles = ['Admin']): void
    {
        app(CompanyDirectory::class)->setMembership($user->id, $company->id, true);

        if ($roles !== []) {
            app(UserAdministration::class)->syncRoles(null, $user, $company->id, $roles);
        }

        self::fresh();
    }

    /**
     * @return array<string, string>
     */
    public static function headers(?Company $company = null, bool $idempotent = false): array
    {
        $headers = ['Referer' => self::SPA, 'Accept' => 'application/json'];

        if ($company !== null) {
            $headers['X-Company-Id'] = $company->id;
        }

        if ($idempotent) {
            $headers['Idempotency-Key'] = (string) Str::uuid7();
        }

        return $headers;
    }

    /**
     * Forget per-request state that a real server would not carry into the next request.
     */
    public static function fresh(): void
    {
        app('auth')->forgetGuards();
        // The test app keeps one session Store across requests; a server would build a new one.
        app('session')->forgetDrivers();
        app()->forgetInstance('session.store');
        app()->forgetScopedInstances();
        app(CompanyContext::class)->clear();
    }

    /**
     * @param  TestResponse<Response>  $response
     */
    public static function sessionCookie(TestResponse $response): string
    {
        $name = config('session.cookie');
        $cookie = $response->getCookie(is_string($name) ? $name : 'laravel_session');

        if ($cookie === null || ! is_string($cookie->getValue())) {
            throw new \RuntimeException('Response carries no session cookie.');
        }

        return $cookie->getValue();
    }
}
