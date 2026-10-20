<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Core\Company\MembershipChecker;
use Illuminate\Auth\GenericUser;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Spatie\Permission\PermissionRegistrar;

beforeEach(function (): void {
    $this->company = (string) Str::uuid7();
    $this->user = new GenericUser(['id' => (string) Str::uuid7()]);

    Route::prefix('api/v1/_probe')->middleware(['api', 'company'])->group(function (): void {
        Route::get('/company', fn () => [
            'company' => app(CompanyContext::class)->id(),
            'team' => app(PermissionRegistrar::class)->getPermissionsTeamId(),
        ]);
    });
});

function allowMembership(string $userId, string $companyId): void
{
    app()->instance(MembershipChecker::class, new class($userId, $companyId) implements MembershipChecker
    {
        public function __construct(private string $userId, private string $companyId) {}

        public function isMember(string $userId, string $companyId): bool
        {
            return $userId === $this->userId && $companyId === $this->companyId;
        }
    });
}

it('denies a user who is not a member', function (): void {

    $this->actingAs($this->user)
        ->getJson('/api/v1/_probe/company', ['X-Company-Id' => $this->company])
        ->assertStatus(403)
        ->assertJsonPath('errors.code', 'COMPANY_FORBIDDEN');
});

it('requires authentication', function (): void {
    $this->getJson('/api/v1/_probe/company', ['X-Company-Id' => $this->company])
        ->assertStatus(401)
        ->assertJsonPath('errors.code', 'UNAUTHENTICATED');
});

it('requires a valid company header', function (?string $header): void {
    $headers = $header === null ? [] : ['X-Company-Id' => $header];

    $this->actingAs($this->user)
        ->getJson('/api/v1/_probe/company', $headers)
        ->assertStatus(400)
        ->assertJsonPath('errors.code', 'COMPANY_REQUIRED');
})->with([null, '', 'not-a-uuid']);

it('activates the company and spatie team for a member', function (): void {
    allowMembership((string) $this->user->getAuthIdentifier(), $this->company);

    $this->actingAs($this->user)
        ->getJson('/api/v1/_probe/company', ['X-Company-Id' => $this->company])
        ->assertOk()
        ->assertExactJson(['company' => $this->company, 'team' => $this->company]);
});

it('rejects a member of another company', function (): void {
    allowMembership((string) $this->user->getAuthIdentifier(), (string) Str::uuid7());

    $this->actingAs($this->user)
        ->getJson('/api/v1/_probe/company', ['X-Company-Id' => $this->company])
        ->assertStatus(403)
        ->assertJsonPath('errors.code', 'COMPANY_FORBIDDEN');
});
