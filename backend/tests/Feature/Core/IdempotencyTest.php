<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Core\Company\MembershipChecker;
use App\Core\Idempotency\EnsureIdempotency;
use Illuminate\Auth\GenericUser;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->calls = 0;
    $this->user = new GenericUser(['id' => (string) Str::uuid7()]);

    Route::prefix('api/v1/_probe')->middleware(['api', 'idempotent'])->group(function (): void {
        Route::post('/orders', function (Request $request) {
            $this->calls++;

            return new JsonResponse(['data' => ['n' => $this->calls, 'name' => $request->input('name')]], 201, [
                'Location' => '/orders/'.$this->calls,
            ]);
        });
        Route::post('/fail', function () {
            $this->calls++;

            throw new RuntimeException('boom');
        });
        Route::patch('/orders/{id}', fn () => ['data' => ['n' => ++$this->calls]]);
        Route::get('/orders', fn () => ['data' => ['n' => ++$this->calls]]);
    });
});

it('requires a key on POST', function (): void {
    $this->postJson('/api/v1/_probe/orders', ['name' => 'a'])
        ->assertStatus(400)
        ->assertJsonPath('errors.code', 'IDEMPOTENCY_KEY_REQUIRED');

    expect($this->calls)->toBe(0);
});

it('replays the stored response for the same key and body', function (): void {
    $headers = ['Idempotency-Key' => 'k-1'];

    $this->postJson('/api/v1/_probe/orders', ['name' => 'a'], $headers)
        ->assertCreated()
        ->assertJsonPath('data.n', 1)
        ->assertHeaderMissing(EnsureIdempotency::REPLAY_HEADER);

    $this->postJson('/api/v1/_probe/orders', ['name' => 'a'], $headers)
        ->assertCreated()
        ->assertJsonPath('data.n', 1)
        ->assertHeader('Location', '/orders/1')
        ->assertHeader(EnsureIdempotency::REPLAY_HEADER, 'true');

    expect($this->calls)->toBe(1);
});

it('rejects the same key with another body', function (): void {
    $headers = ['Idempotency-Key' => 'k-2'];

    $this->postJson('/api/v1/_probe/orders', ['name' => 'a'], $headers)->assertCreated();
    $this->postJson('/api/v1/_probe/orders', ['name' => 'b'], $headers)
        ->assertStatus(422)
        ->assertJsonPath('errors.code', 'IDEMPOTENCY_KEY_REUSED');

    expect($this->calls)->toBe(1);
});

it('answers 409 while the first request is still running', function (): void {
    $this->postJson('/api/v1/_probe/orders', ['name' => 'a'], ['Idempotency-Key' => 'k-3'])->assertCreated();
    DB::table('idempotency_keys')->update(['status' => 'processing']);

    $this->postJson('/api/v1/_probe/orders', ['name' => 'a'], ['Idempotency-Key' => 'k-3'])
        ->assertStatus(409)
        ->assertJsonPath('errors.code', 'IDEMPOTENCY_IN_PROGRESS');
});

it('keeps server errors retryable', function (): void {
    $this->postJson('/api/v1/_probe/fail', [], ['Idempotency-Key' => 'k-4'])->assertStatus(500);
    $this->postJson('/api/v1/_probe/fail', [], ['Idempotency-Key' => 'k-4'])->assertStatus(500);

    expect($this->calls)->toBe(2)
        ->and(DB::table('idempotency_keys')->count())->toBe(0);
});

it('scopes keys per user and company', function (): void {
    $company = (string) Str::uuid7();
    $other = new GenericUser(['id' => (string) Str::uuid7()]);
    $headers = ['Idempotency-Key' => 'shared'];

    $this->actingAs($this->user)->postJson('/api/v1/_probe/orders', ['name' => 'a'], $headers)->assertJsonPath('data.n', 1);
    $this->actingAs($other)->postJson('/api/v1/_probe/orders', ['name' => 'a'], $headers)->assertJsonPath('data.n', 2);

    app(CompanyContext::class)->set($company);
    $this->actingAs($this->user)->postJson('/api/v1/_probe/orders', ['name' => 'a'], $headers)->assertJsonPath('data.n', 3);

    expect(DB::table('idempotency_keys')->where('company_id', $company)->count())->toBe(1);
});

it('runs after the company middleware so the company is part of the scope', function (): void {
    $company = (string) Str::uuid7();
    app()->instance(MembershipChecker::class, new class implements MembershipChecker
    {
        public function isMember(string $userId, string $companyId): bool
        {
            return true;
        }
    });

    // Declared in the "wrong" order on purpose; the priority list fixes it.
    Route::post('/api/v1/_probe/scoped', fn () => ['data' => true])->middleware(['api', 'idempotent', 'company']);

    $this->actingAs($this->user)
        ->postJson('/api/v1/_probe/scoped', [], ['Idempotency-Key' => 'k-5', 'X-Company-Id' => $company])
        ->assertOk();

    expect(DB::table('idempotency_keys')->value('company_id'))->toBe($company);
});

it('starts over after the key expires', function (): void {
    $headers = ['Idempotency-Key' => 'k-6'];

    $this->postJson('/api/v1/_probe/orders', ['name' => 'a'], $headers)->assertJsonPath('data.n', 1);
    DB::table('idempotency_keys')->update(['expires_at' => Carbon::now()->subMinute()]);

    $this->postJson('/api/v1/_probe/orders', ['name' => 'b'], $headers)->assertJsonPath('data.n', 2);
});

it('passes GET through and makes the key optional for PATCH', function (): void {
    $this->getJson('/api/v1/_probe/orders')->assertOk();
    $this->patchJson('/api/v1/_probe/orders/1')->assertOk();
    $this->patchJson('/api/v1/_probe/orders/1', [], ['Idempotency-Key' => 'k-7'])->assertJsonPath('data.n', 3);
    $this->patchJson('/api/v1/_probe/orders/1', [], ['Idempotency-Key' => 'k-7'])->assertJsonPath('data.n', 3);

    expect($this->calls)->toBe(3);
});
