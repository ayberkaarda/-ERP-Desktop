<?php

declare(strict_types=1);

use App\Core\Company\CompanyContext;
use App\Core\Company\CompanyGuard;
use App\Core\Company\MissingCompanyContext;
use App\Core\Http\ApiException;
use App\Core\Http\ErrorCode;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Spatie\Permission\PermissionRegistrar;
use Tests\Fixtures\FixtureDocument;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    FixtureDocument::createTable();
    $this->a = (string) Str::uuid7();
    $this->b = (string) Str::uuid7();
    $this->ctx = app(CompanyContext::class);
});

it('throws when no company is active and syncs the spatie team id', function (): void {
    expect($this->ctx->idOrNull())->toBeNull()
        ->and(fn () => $this->ctx->id())->toThrow(MissingCompanyContext::class);

    $this->ctx->set($this->a);

    expect($this->ctx->id())->toBe($this->a)
        ->and(app(PermissionRegistrar::class)->getPermissionsTeamId())->toBe($this->a);
});

it('rejects non uuid company ids', function (): void {
    expect(fn () => $this->ctx->set('1'))->toThrow(InvalidArgumentException::class);
});

it('restores the previous company after runAs, even on failure', function (): void {
    $this->ctx->set($this->a);

    expect($this->ctx->runAs($this->b, fn () => $this->ctx->id()))->toBe($this->b)
        ->and($this->ctx->id())->toBe($this->a);

    expect(fn () => $this->ctx->runAs($this->b, fn () => throw new RuntimeException('x')))
        ->toThrow(RuntimeException::class);
    expect($this->ctx->id())->toBe($this->a)
        ->and(app(PermissionRegistrar::class)->getPermissionsTeamId())->toBe($this->a);
});

it('is a scoped singleton', function (): void {
    expect(app(CompanyContext::class))->toBe($this->ctx);

    app()->forgetScopedInstances();

    expect(app(CompanyContext::class))->not->toBe($this->ctx);
});

it('stamps company_id on create and scopes reads to the active company', function (): void {
    $this->ctx->runAs($this->a, fn () => FixtureDocument::create(['name' => 'a1']));
    $this->ctx->runAs($this->b, fn () => FixtureDocument::create(['name' => 'b1']));

    $names = $this->ctx->runAs($this->a, fn () => FixtureDocument::pluck('name')->all());
    $docA = $this->ctx->runAs($this->a, fn () => FixtureDocument::firstOrFail());

    expect($names)->toBe(['a1'])
        ->and($docA->company_id)->toBe($this->a)
        ->and(FixtureDocument::count())->toBe(0)
        ->and(FixtureDocument::withoutCompanyScope()->count())->toBe(2);
});

it('refuses to create a company row without an active company', function (): void {
    expect(fn () => FixtureDocument::create(['name' => 'orphan']))->toThrow(MissingCompanyContext::class);
});

it('accepts an explicit company_id equal to the active company', function (): void {
    $doc = $this->ctx->runAs($this->a, fn () => FixtureDocument::create(['name' => 'x', 'company_id' => $this->a]));

    expect($doc->company_id)->toBe($this->a);
});

it('refuses an explicit company_id of another company', function (): void {
    $this->ctx->set($this->a);

    expect(fn () => FixtureDocument::create(['name' => 'x', 'company_id' => $this->b]))
        ->toThrow(fn (ApiException $e) => expect($e->errorCode)->toBe(ErrorCode::CompanyForbidden));
    expect(FixtureDocument::withoutCompanyScope()->count())->toBe(0);
});

it('refuses an explicit company_id without an active company', function (): void {
    expect(fn () => FixtureDocument::create(['name' => 'x', 'company_id' => $this->b]))
        ->toThrow(MissingCompanyContext::class);
});

it('makes company_id immutable on update', function (): void {
    $this->ctx->set($this->a);
    $doc = FixtureDocument::create(['name' => 'x']);

    expect(fn () => $doc->update(['company_id' => $this->b]))
        ->toThrow(fn (ApiException $e) => expect($e->errorCode)->toBe(ErrorCode::CompanyForbidden));
    expect(FixtureDocument::withoutCompanyScope()->where('company_id', $this->b)->count())->toBe(0);
});

it('lets privileged system code bypass the write rules explicitly', function (): void {
    $doc = CompanyGuard::bypass(fn () => FixtureDocument::create(['name' => 'x', 'company_id' => $this->b]));
    CompanyGuard::bypass(fn () => $doc->update(['company_id' => $this->a]));

    expect(FixtureDocument::find($doc->id))->toBeNull() // scoped out: no active company
        ->and(FixtureDocument::withoutCompanyScope()->findOrFail($doc->id)->company_id)->toBe($this->a)
        ->and(CompanyGuard::bypassed())->toBeFalse();
});

it('uses uuidv7 string keys', function (): void {
    $doc = $this->ctx->runAs($this->a, fn () => FixtureDocument::create(['name' => 'k']));

    expect($doc->getKey())->toBeString()
        ->and(Str::isUuid($doc->getKey()))->toBeTrue()
        ->and(substr($doc->getKey(), 14, 1))->toBe('7')
        ->and($doc->getIncrementing())->toBeFalse()
        ->and($doc->getKeyType())->toBe('string');
});
