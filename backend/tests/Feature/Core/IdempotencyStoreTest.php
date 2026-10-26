<?php

declare(strict_types=1);

use App\Core\Idempotency\ClaimStatus;
use App\Core\Idempotency\IdempotencyScope;
use App\Core\Idempotency\IdempotencyStore;
use App\Core\Idempotency\StoredResponse;
use App\Core\Sync\SyncConfig;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\Companies;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->store = app(IdempotencyStore::class);
    $this->user = (string) Str::uuid7();
    $this->company = Companies::make();
    $this->scope = fn (string $key, string $namespace = SyncConfig::PUSH_IDEMPOTENCY_SCOPE): IdempotencyScope => new IdempotencyScope($key, $this->user, $this->company, $namespace);
    $this->ttl = app(SyncConfig::class)->idempotencyTtlSeconds();
    // request_hash is char(64): fingerprints are sha256 hex.
    $this->a = hash('sha256', 'a');
    $this->b = hash('sha256', 'b');
});

afterEach(fn () => Carbon::setTestNow());

it('keeps the plain scope hash of the HTTP middleware', function (): void {
    $scope = new IdempotencyScope('k', 'u', 'c');

    expect($scope->hash())->toBe(hash('sha256', "u\0c\0k"))
        ->and((new IdempotencyScope('k', 'u', 'c', 'sync.push'))->hash())->not->toBe($scope->hash());
});

it('claims a key, stores the outcome and serves it again for the same fingerprint', function (): void {
    $claim = $this->store->claim(($this->scope)('m-1'), $this->a, $this->ttl, 'POST', '/api/v1/sync/push');

    expect($claim->status)->toBe(ClaimStatus::Claimed)->and($claim->claimId)->not->toBeNull();
    expect($this->store->complete((string) $claim->claimId, new StoredResponse(200, '{"status":"applied"}')))->toBeTrue();

    $again = $this->store->claim(($this->scope)('m-1'), $this->a, $this->ttl);

    expect($again->status)->toBe(ClaimStatus::Completed)
        ->and($again->response?->body)->toBe('{"status":"applied"}')
        ->and($again->response?->status)->toBe(200)
        ->and($this->store->lookup(($this->scope)('m-1'))?->body)->toBe('{"status":"applied"}');
});

it('reports reuse with another fingerprint and in-progress while unfinished', function (): void {
    $this->store->claim(($this->scope)('m-2'), $this->a, $this->ttl);

    expect($this->store->claim(($this->scope)('m-2'), $this->a, $this->ttl)->status)->toBe(ClaimStatus::InProgress)
        ->and($this->store->claim(($this->scope)('m-2'), $this->b, $this->ttl)->status)->toBe(ClaimStatus::Reused)
        ->and($this->store->lookup(($this->scope)('m-2')))->toBeNull();
});

it('separates namespaces, users and companies', function (): void {
    $this->store->claim(($this->scope)('same'), $this->a, $this->ttl);

    expect($this->store->claim(($this->scope)('same', ''), $this->b, $this->ttl)->status)->toBe(ClaimStatus::Claimed)
        ->and($this->store->claim(new IdempotencyScope('same', (string) Str::uuid7(), $this->company, 'sync.push'), $this->b, $this->ttl)->status)->toBe(ClaimStatus::Claimed)
        ->and($this->store->claim(new IdempotencyScope('same', $this->user, Companies::make(), 'sync.push'), $this->b, $this->ttl)->status)->toBe(ClaimStatus::Claimed);
});

it('releases a claim so the same request can run again', function (): void {
    $claim = $this->store->claim(($this->scope)('m-3'), $this->a, $this->ttl);
    $this->store->release((string) $claim->claimId);

    expect($this->store->claim(($this->scope)('m-3'), $this->a, $this->ttl)->status)->toBe(ClaimStatus::Claimed);
});

it('fences a holder whose lease was taken over', function (): void {
    Carbon::setTestNow('2027-08-01 10:00:00');
    $first = $this->store->claim(($this->scope)('m-4'), $this->a, $this->ttl);

    Carbon::setTestNow('2027-08-01 10:06:00'); // lease (300 s) has run out
    $second = $this->store->claim(($this->scope)('m-4'), $this->a, $this->ttl);

    expect($second->status)->toBe(ClaimStatus::Claimed)
        ->and($this->store->complete((string) $first->claimId, new StoredResponse(200, 'late')))->toBeFalse()
        ->and($this->store->complete((string) $second->claimId, new StoredResponse(200, 'retry')))->toBeTrue()
        ->and($this->store->lookup(($this->scope)('m-4'))?->body)->toBe('retry');
});

it('keeps push outcomes for the sync retention of seven days', function (): void {
    Carbon::setTestNow('2027-08-01 10:00:00');
    $claim = $this->store->claim(($this->scope)('m-5'), $this->a, $this->ttl);
    $this->store->complete((string) $claim->claimId, new StoredResponse(200, 'kept'));

    expect($this->ttl)->toBe(7 * 86400)
        ->and(Carbon::parse((string) DB::table('idempotency_keys')->where('key', 'm-5')->value('expires_at'))->equalTo(Carbon::parse('2027-08-08 10:00:00')))->toBeTrue();

    Carbon::setTestNow('2027-08-08 09:59:00');
    expect($this->store->lookup(($this->scope)('m-5'))?->body)->toBe('kept');

    Carbon::setTestNow('2027-08-08 10:01:00');
    expect($this->store->lookup(($this->scope)('m-5')))->toBeNull()
        ->and($this->store->prune())->toBe(1)
        ->and($this->store->claim(($this->scope)('m-5'), $this->b, $this->ttl)->status)->toBe(ClaimStatus::Claimed);
});
