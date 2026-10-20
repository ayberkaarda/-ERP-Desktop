<?php

declare(strict_types=1);

use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;

beforeEach(function (): void {
    Route::prefix('api/v1/_probe')->middleware('api')->group(function (): void {
        Route::post('/validation', fn (Request $request) => $request->validate([
            'name' => ['required', 'string'],
        ]));
        Route::get('/auth', fn () => 'ok')->middleware('auth:sanctum');
        Route::get('/forbidden', fn () => throw new AuthorizationException('hidden'));
        Route::get('/model', fn () => throw (new ModelNotFoundException)->setModel(User::class, [1]));
        Route::get('/throttle', fn () => 'ok')->middleware('throttle:1,1');
        Route::get('/boom', fn () => throw new RuntimeException('secret internals'));
    });
});

function assertEnvelope(TestResponse $response, int $status, string $code): void
{
    $response->assertStatus($status)
        ->assertJsonPath('errors.code', $code)
        ->assertJsonStructure(['errors' => ['message', 'code']]);

    expect($response->json('errors.message'))->toBeString()->not->toBeEmpty();
}

it('renders validation errors with fields', function (): void {
    $response = $this->postJson('/api/v1/_probe/validation', []);

    assertEnvelope($response, 422, 'VALIDATION_ERROR');
    $response->assertJsonStructure(['errors' => ['fields' => ['name']]]);
});

it('renders unauthenticated requests', function (): void {
    assertEnvelope($this->getJson('/api/v1/_probe/auth'), 401, 'UNAUTHENTICATED');
});

it('renders forbidden without leaking the exception message', function (): void {
    $response = $this->getJson('/api/v1/_probe/forbidden');

    assertEnvelope($response, 403, 'FORBIDDEN');
    expect($response->json('errors.message'))->not->toBe('hidden');
});

it('renders unknown routes and missing models as not found', function (string $uri): void {
    assertEnvelope($this->getJson($uri), 404, 'NOT_FOUND');
})->with(['/api/v1/does-not-exist', '/api/v1/_probe/model']);

it('renders wrong methods', function (): void {
    assertEnvelope($this->postJson('/api/v1/health'), 405, 'METHOD_NOT_ALLOWED');
});

it('renders throttled requests with retry headers', function (): void {
    $this->getJson('/api/v1/_probe/throttle')->assertOk();

    $response = $this->getJson('/api/v1/_probe/throttle');

    assertEnvelope($response, 429, 'TOO_MANY_ATTEMPTS');
    $response->assertHeader('Retry-After');
});

it('renders server errors without internals', function (): void {
    $response = $this->getJson('/api/v1/_probe/boom');

    assertEnvelope($response, 500, 'SERVER_ERROR');
    expect($response->getContent())->not->toContain('secret internals');
});

it('localizes messages', function (): void {
    app()->setLocale('tr');

    $this->getJson('/api/v1/does-not-exist')
        ->assertJsonPath('errors.message', 'İstenen kayıt bulunamadı.');
});
